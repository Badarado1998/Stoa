// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StoaRouter} from "./StoaRouter.sol";

/// @title SpotlightMarket
/// @notice A weekly market for Stoa's sponsored token slots, paid in ETH to $STOA holders.
///         - Projects bid ETH for a token during the first five days of a week (an epoch). A token's first bid also
///           pays an entry fee that is never refunded and goes to the burn pot; it grows with the number of tokens
///           already in the week, so spamming the list is expensive, and the guardian can cancel spam to free places.
///         - Holders lock $STOA and split their votes over up to ten tokens, until the week ends.
///         - After the week, anyone calls `finalize`: among tokens whose votes reach the quorum, the largest ETH bids
///           win the week's slots (ties go to the token that entered first). A cut of each winning bid goes to the
///           burn pot; the rest is paid to that token's voters, pro rata to their votes. Every other bid is refunded.
///         - The keeper spends the burn pot on $STOA through the Stoa router and sends it straight to 0x...dEaD.
/// @dev Nobody can withdraw anyone's ETH or $STOA: the guardian can only pause new activity and cancel a bid (which
///      makes it refundable); only the owner (the 48h timelock) unpauses and sets the parameters, within fixed bounds,
///      for later weeks only. Claims, refunds and withdrawals work while paused, and a pause lets every holder take
///      their $STOA out at once. Votes used in a week cannot be unlocked until the next week starts, and unlocking
///      lasts until the end of the week it is requested in, so the same $STOA never votes twice in one week.
contract SpotlightMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    struct Params {
        uint8 slots; // winners per week, 1..MAX_SLOTS
        uint16 cutBps; // share of a winning bid sent to the burn pot, <= MAX_CUT_BPS
        uint64 entryFee; // wei paid once by a token's first bid in a week, never refunded, <= MAX_ENTRY_FEE
        uint64 minBid; // wei, a token's first bid (after the entry fee) must be at least this, <= MAX_MIN_BID
        uint96 maxBid; // wei, cap on a token's total bid in a week, >= minBid
        uint128 quorum; // $STOA votes a token needs to be eligible, > 0
    }

    struct Account {
        uint128 active; // locked and able to vote
        uint128 pending; // waiting to be withdrawn
        uint64 unlockAt; // when `pending` can be withdrawn
    }

    struct Candidate {
        uint128 pot; // ETH bid for the token this week (entry fee excluded)
        uint128 votes; // $STOA votes for the token this week
        uint128 payout; // ETH for the token's voters, set when it wins
        uint8 index; // position in the week's candidate list (entry order, < MAX_LISTED)
        bool listed;
        bool canceled;
        bool won;
    }

    struct Epoch {
        Params params; // the rules this week runs on, copied when its first bid lands
        bool opened;
        bool finalized;
        uint16 active; // candidates not canceled
        address[] candidates;
        address[] winners;
    }

    // ---------------------------------------------------------------- constants

    uint256 public constant WEEK = 7 days;
    /// @notice bids, top-ups and cancels close this long after a week starts; the last two days are for votes only
    uint256 public constant BID_WINDOW = 5 days;
    /// @notice tokens that can be in the race at once; a canceled token frees its place
    uint256 public constant MAX_CANDIDATES = 100;
    /// @notice tokens that can enter a week at all, canceled ones included (bounds `finalize`)
    uint256 public constant MAX_LISTED = 255;
    /// @notice the entry fee grows by one base fee every this many tokens already entered in the week
    uint256 public constant FEE_STEP = 20;
    uint256 public constant MAX_VOTES_PER_HOLDER = 10;
    uint8 public constant MAX_SLOTS = 5;
    uint16 public constant MAX_CUT_BPS = 2000;
    uint256 public constant MAX_ENTRY_FEE = 0.01 ether;
    uint256 public constant MAX_MIN_BID = 1 ether;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    address public constant NATIVE = address(0);

    // ---------------------------------------------------------------- state

    IERC20 public immutable stoa;
    StoaRouter public immutable router;
    /// @notice start of week 0 (unix seconds); week e runs [start + e*WEEK, start + (e+1)*WEEK)
    uint256 public immutable start;

    address public guardian;
    address public keeper;
    bool public paused;

    Params internal _params;
    Params internal _nextParams;
    /// @notice the first week `_nextParams` applies to; type(uint256).max when nothing is queued
    uint256 public nextParamsFrom = type(uint256).max;

    mapping(uint256 epoch => Epoch) internal _epochs;
    mapping(uint256 epoch => mapping(address token => Candidate)) public candidates;
    mapping(uint256 epoch => mapping(address token => mapping(address bidder => uint256))) public contribution;
    mapping(uint256 epoch => mapping(address token => mapping(address voter => uint256))) public votesOf;
    mapping(uint256 epoch => mapping(address voter => address[])) internal _votedTokens;
    mapping(uint256 epoch => mapping(address voter => uint256)) public usedVotes;
    mapping(uint256 epoch => mapping(address token => mapping(address voter => bool))) public claimed;
    mapping(address holder => Account) public accounts;

    /// @notice $STOA held for holders (active + pending)
    uint256 public totalLocked;
    /// @notice ETH waiting to be spent on $STOA and burned
    uint256 public burnPot;
    /// @notice $STOA bought with the burn pot and burned so far
    uint256 public totalBurned;
    /// @notice ETH set aside for voters of winning tokens so far
    uint256 public totalPaidToVoters;

    // ---------------------------------------------------------------- events

    event Locked(address indexed holder, uint256 amount);
    event UnlockRequested(address indexed holder, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed holder, address to, uint256 amount);
    event EmergencyWithdrawn(address indexed holder, address to, uint256 amount);
    event Bid(uint256 indexed epoch, address indexed token, address indexed bidder, uint256 amount, uint256 entryFee);
    event Voted(uint256 indexed epoch, address indexed voter, address[] tokens, uint256[] amounts);
    event Canceled(uint256 indexed epoch, address indexed token);
    event Finalized(uint256 indexed epoch, address[] winners, uint256 toVoters, uint256 toBurnPot);
    event Claimed(uint256 indexed epoch, address indexed token, address indexed voter, address to, uint256 amount);
    event Refunded(uint256 indexed epoch, address indexed token, address indexed bidder, address to, uint256 amount);
    event Burned(uint256 ethIn, uint256 stoaBurned);
    event ParamsQueued(Params params, uint256 fromEpoch);
    event Paused(bool paused);
    event GuardianSet(address guardian);
    event KeeperSet(address keeper);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error ZeroAmount();
    error BadParams();
    error NotStarted();
    error IsPaused();
    error NotPausedNow();
    error NotGuardian();
    error NotKeeper();
    error BiddingClosed();
    error BadToken();
    error Canceled_();
    error TooManyCandidates();
    error BidTooSmall();
    error BidTooLarge();
    error NotCandidate();
    error TooManyVotes();
    error DuplicateToken();
    error NotEnoughPower();
    error LengthMismatch();
    error EpochNotOver();
    error AlreadyFinalized();
    error NotFinalized();
    error NotWinner();
    error NothingToClaim();
    error NotRefundable();
    error StillLocked();
    error InsufficientUnlocked();
    error UnsupportedToken();
    error TransferFailed();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(
        address owner_,
        StoaRouter router_,
        IERC20 stoa_,
        address guardian_,
        address keeper_,
        uint256 start_,
        Params memory params_
    ) Ownable(owner_) {
        if (
            address(router_) == address(0) || address(stoa_) == address(0) || guardian_ == address(0)
                || keeper_ == address(0) || start_ == 0
        ) revert ZeroAddress();
        _validate(params_);
        router = router_;
        stoa = stoa_;
        start = start_;
        guardian = guardian_;
        keeper = keeper_;
        _params = params_;
        emit GuardianSet(guardian_);
        emit KeeperSet(keeper_);
        emit ParamsQueued(params_, 0);
    }

    // ================================================================ views

    function started() public view returns (bool) {
        return block.timestamp >= start;
    }

    /// @notice the week in progress (reverts before week 0 starts)
    function currentEpoch() public view returns (uint256) {
        if (block.timestamp < start) revert NotStarted();
        return (block.timestamp - start) / WEEK;
    }

    function epochStart(uint256 epoch) public view returns (uint256) {
        return start + epoch * WEEK;
    }

    /// @notice the rules week `epoch` runs on: its own copy once opened, otherwise what is set for it now
    function paramsFor(uint256 epoch) public view returns (Params memory) {
        if (_epochs[epoch].opened) return _epochs[epoch].params;
        return epoch >= nextParamsFrom ? _nextParams : _params;
    }

    function epochInfo(uint256 epoch)
        external
        view
        returns (Params memory params, bool opened, bool finalized, address[] memory list, address[] memory winners)
    {
        Epoch storage ep = _epochs[epoch];
        return (paramsFor(epoch), ep.opened, ep.finalized, ep.candidates, ep.winners);
    }

    /// @notice the entry fee the next new token pays in `epoch`: the base fee times (1 + entered / FEE_STEP), so a
    ///         week stays cheap for the first projects and filling it with spam gets expensive fast
    function entryFeeFor(uint256 epoch) public view returns (uint256) {
        return uint256(paramsFor(epoch).entryFee) * (1 + _epochs[epoch].candidates.length / FEE_STEP);
    }

    function votedTokens(uint256 epoch, address voter) external view returns (address[] memory) {
        return _votedTokens[epoch][voter];
    }

    /// @notice ETH `voter` can claim for `token` in `epoch` (0 if not finalized, lost, nothing voted, or claimed)
    function claimable(uint256 epoch, address token, address voter) public view returns (uint256) {
        Candidate storage c = candidates[epoch][token];
        if (!c.won || claimed[epoch][token][voter]) return 0;
        uint256 v = votesOf[epoch][token][voter];
        return v == 0 ? 0 : uint256(c.payout) * v / c.votes;
    }

    /// @notice ETH `bidder` can take back for `token` in `epoch` (0 while it can still win)
    function refundable(uint256 epoch, address token, address bidder) public view returns (uint256) {
        Candidate storage c = candidates[epoch][token];
        if (!(c.canceled || (_epochs[epoch].finalized && !c.won))) return 0;
        return contribution[epoch][token][bidder];
    }

    /// @notice $STOA `holder` can still allocate this week, or could request to unlock now
    function availableVotes(address holder) public view returns (uint256) {
        uint256 active = accounts[holder].active;
        if (block.timestamp < start) return active;
        uint256 used = usedVotes[currentEpoch()][holder];
        return active > used ? active - used : 0;
    }

    // ================================================================ holders

    /// @notice Lock `amount` $STOA (approve this contract first). Locked $STOA votes from now on.
    function lock(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Account storage a = accounts[msg.sender];
        if (amount + a.active + a.pending > type(uint128).max) revert UnsupportedToken();
        uint256 before = stoa.balanceOf(address(this));
        stoa.safeTransferFrom(msg.sender, address(this), amount);
        if (stoa.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
        a.active += uint128(amount);
        totalLocked += amount;
        emit Locked(msg.sender, amount);
    }

    /// @notice Start unlocking `amount` of your active $STOA. It stops voting now and can be withdrawn when the
    ///         current week ends. $STOA that voted this week can only be requested from next week on. A matured
    ///         earlier request is paid out first.
    function requestUnlock(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = accounts[msg.sender];
        if (amount > availableVotes(msg.sender)) revert InsufficientUnlocked();
        uint256 matured;
        if (a.pending > 0 && block.timestamp >= a.unlockAt) {
            matured = a.pending;
            a.pending = 0;
        }
        a.active -= uint128(amount);
        a.pending += uint128(amount);
        a.unlockAt = uint64(block.timestamp < start ? start : epochStart(currentEpoch() + 1));
        emit UnlockRequested(msg.sender, amount, a.unlockAt);
        if (matured > 0) {
            totalLocked -= matured;
            emit Withdrawn(msg.sender, msg.sender, matured);
            stoa.safeTransfer(msg.sender, matured);
        }
    }

    /// @notice Withdraw $STOA whose unlock has matured.
    function withdraw(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        Account storage a = accounts[msg.sender];
        uint256 amount = a.pending;
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < a.unlockAt) revert StillLocked();
        a.pending = 0;
        totalLocked -= amount;
        emit Withdrawn(msg.sender, to, amount);
        stoa.safeTransfer(to, amount);
    }

    /// @notice While paused: take all your $STOA out at once. Your votes in the week in progress are removed, so
    ///         the same $STOA can never be counted twice in a week. Votes in weeks that already ended stay valid.
    function emergencyWithdraw(address to) external nonReentrant {
        if (!paused) revert NotPausedNow();
        if (to == address(0)) revert ZeroAddress();
        Account storage a = accounts[msg.sender];
        uint256 amount = uint256(a.active) + a.pending;
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= start) _clearVotes(currentEpoch(), msg.sender);
        a.active = 0;
        a.pending = 0;
        totalLocked -= amount;
        emit EmergencyWithdrawn(msg.sender, to, amount);
        stoa.safeTransfer(to, amount);
    }

    /// @notice Set your votes for the week in progress: `amounts[i]` $STOA for `tokens[i]`. Replaces your earlier
    ///         votes this week. Each token must be a candidate this week and not canceled; the total cannot exceed
    ///         your active $STOA. Send empty arrays to withdraw all your votes.
    function vote(address[] calldata tokens, uint256[] calldata amounts) external whenNotPaused {
        if (tokens.length != amounts.length) revert LengthMismatch();
        if (tokens.length > MAX_VOTES_PER_HOLDER) revert TooManyVotes();
        uint256 epoch = currentEpoch();
        _clearVotes(epoch, msg.sender);
        uint256 total;
        address[] storage mine = _votedTokens[epoch][msg.sender];
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 amt = amounts[i];
            if (amt == 0) revert ZeroAmount();
            Candidate storage c = candidates[epoch][t];
            if (!c.listed) revert NotCandidate();
            if (c.canceled) revert Canceled_();
            if (votesOf[epoch][t][msg.sender] != 0) revert DuplicateToken();
            votesOf[epoch][t][msg.sender] = amt;
            c.votes += uint128(amt);
            mine.push(t);
            total += amt;
        }
        if (total > accounts[msg.sender].active) revert NotEnoughPower();
        usedVotes[epoch][msg.sender] = total;
        emit Voted(epoch, msg.sender, tokens, amounts);
    }

    /// @notice Claim your share of a winning token's ETH for a finished week.
    function claim(uint256 epoch, address token, address to) external nonReentrant returns (uint256 amount) {
        amount = _claim(epoch, token, to);
        _send(to, amount);
    }

    /// @notice Claim several (week, token) shares in one transaction.
    function claimMany(uint256[] calldata epochs, address[] calldata tokens, address to)
        external
        nonReentrant
        returns (uint256 total)
    {
        if (epochs.length != tokens.length) revert LengthMismatch();
        for (uint256 i; i < epochs.length; ++i) {
            total += _claim(epochs[i], tokens[i], to);
        }
        _send(to, total);
    }

    // ================================================================ projects

    /// @notice Bid `msg.value` ETH for `token` in the week in progress. A token's first bid of the week pays the
    ///         entry fee (never refunded, it goes to the burn pot) and must leave at least the minimum bid. Anyone can
    ///         add to a token's bid; each contributor can take theirs back if the token does not win.
    function bid(address token) external payable nonReentrant whenNotPaused {
        uint256 epoch = currentEpoch();
        if (block.timestamp >= epochStart(epoch) + BID_WINDOW) revert BiddingClosed();
        if (token == address(0) || token == address(stoa)) revert BadToken();
        Epoch storage ep = _epochs[epoch];
        if (!ep.opened) {
            ep.params = paramsFor(epoch);
            ep.opened = true;
        }
        Params memory p = ep.params;
        Candidate storage c = candidates[epoch][token];
        if (c.canceled) revert Canceled_();
        uint256 amount = msg.value;
        uint256 fee;
        if (!c.listed) {
            uint256 listed = ep.candidates.length;
            if (ep.active >= MAX_CANDIDATES || listed >= MAX_LISTED) revert TooManyCandidates();
            fee = uint256(p.entryFee) * (1 + listed / FEE_STEP);
            if (amount < fee + p.minBid) revert BidTooSmall();
            amount -= fee;
            burnPot += fee;
            c.listed = true;
            c.index = uint8(listed);
            ep.candidates.push(token);
            ++ep.active;
        } else if (amount == 0) {
            revert ZeroAmount();
        }
        if (uint256(c.pot) + amount > p.maxBid) revert BidTooLarge();
        c.pot += uint128(amount);
        contribution[epoch][token][msg.sender] += amount;
        emit Bid(epoch, token, msg.sender, amount, fee);
    }

    /// @notice Take back your bid for `token` in `epoch` once it cannot win: canceled, or the week finalized
    ///         without it among the winners. The entry fee is not refunded.
    function refund(uint256 epoch, address token, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        Candidate storage c = candidates[epoch][token];
        if (!(c.canceled || (_epochs[epoch].finalized && !c.won))) revert NotRefundable();
        amount = contribution[epoch][token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        contribution[epoch][token][msg.sender] = 0;
        emit Refunded(epoch, token, msg.sender, to, amount);
        _send(to, amount);
    }

    // ================================================================ settlement

    /// @notice Settle a finished week. Anyone can call it once the week is over. Among tokens that are not canceled
    ///         and reached the quorum, the largest bids win (ties: the token that entered first). Each winner's bid
    ///         is split: the cut to the burn pot, the rest to its voters.
    function finalize(uint256 epoch) external nonReentrant returns (address[] memory winners) {
        if (epoch >= currentEpoch()) revert EpochNotOver();
        Epoch storage ep = _epochs[epoch];
        if (ep.finalized) revert AlreadyFinalized();
        ep.finalized = true;
        uint256 toVoters;
        uint256 toBurn;
        if (ep.opened) {
            Params memory p = ep.params;
            address[] memory best = new address[](p.slots);
            uint256 n;
            address[] storage list = ep.candidates;
            for (uint256 i; i < list.length; ++i) {
                address t = list[i];
                Candidate storage c = candidates[epoch][t];
                if (c.canceled || c.votes == 0 || c.votes < p.quorum) continue;
                // insertion into `best`, sorted by pot descending; strict comparison keeps earlier entrants ahead
                uint256 j = n < p.slots ? n : p.slots;
                if (j == p.slots && c.pot <= candidates[epoch][best[p.slots - 1]].pot) continue;
                if (j == p.slots) j = p.slots - 1;
                while (j > 0 && c.pot > candidates[epoch][best[j - 1]].pot) {
                    best[j] = best[j - 1];
                    --j;
                }
                best[j] = t;
                if (n < p.slots) ++n;
            }
            winners = new address[](n);
            for (uint256 k; k < n; ++k) {
                address t = best[k];
                Candidate storage c = candidates[epoch][t];
                uint256 cut = uint256(c.pot) * p.cutBps / 10_000;
                uint256 pay = c.pot - cut;
                c.won = true;
                c.payout = uint128(pay);
                toVoters += pay;
                toBurn += cut;
                winners[k] = t;
                ep.winners.push(t);
            }
            burnPot += toBurn;
            totalPaidToVoters += toVoters;
        }
        emit Finalized(epoch, winners, toVoters, toBurn);
    }

    /// @notice Spend the whole burn pot on $STOA through the Stoa router (route from `router.quote(NATIVE, stoa, burnPot)`)
    ///         and send it straight to the burn address. Keeper or owner only, so `minOut` is set by someone who
    ///         read the price; this keeps the purchase from being sandwiched.
    function burn(address mid, StoaRouter.Leg calldata leg1, StoaRouter.Leg calldata leg2, uint256 minOut)
        external
        nonReentrant
        returns (uint256 burned)
    {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        uint256 amount = burnPot;
        if (amount == 0) revert ZeroAmount();
        burnPot = 0;
        burned = router.swap{value: amount}(
            StoaRouter.SwapParams({
                tokenIn: NATIVE,
                tokenOut: address(stoa),
                mid: mid,
                leg1: leg1,
                leg2: leg2,
                amountIn: amount,
                minOut: minOut,
                to: BURN,
                deadline: block.timestamp,
                referrer: address(0)
            })
        );
        totalBurned += burned;
        emit Burned(amount, burned);
    }

    // ================================================================ guardian and owner

    /// @notice Cancel `token`'s bid in the week in progress (a scam, a honeypot, a token that cannot be sold).
    ///         Only while bids are open, so voters still have two days to move their votes. Its bids become
    ///         refundable in full; the entry fee stays in the burn pot.
    function cancel(address token) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        uint256 epoch = currentEpoch();
        if (block.timestamp >= epochStart(epoch) + BID_WINDOW) revert BiddingClosed();
        Candidate storage c = candidates[epoch][token];
        if (!c.listed) revert NotCandidate();
        if (c.canceled) revert Canceled_();
        c.canceled = true;
        --_epochs[epoch].active;
        emit Canceled(epoch, token);
    }

    /// @notice Stop new locks, bids and votes (guardian or owner). Claims, refunds, withdrawals and finalizing go on,
    ///         and holders can take their $STOA out at once with `emergencyWithdraw`.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = true;
        emit Paused(true);
    }

    /// @notice Only the owner (the 48h timelock) unpauses.
    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice Queue new parameters. They apply from the week after the current one (from week 0 before the start),
    ///         and a week that already took its first bid keeps its own copy.
    function setParams(Params calldata p) external onlyOwner {
        _validate(p);
        uint256 now_ = block.timestamp < start ? 0 : currentEpoch();
        if (nextParamsFrom != type(uint256).max && now_ >= nextParamsFrom) _params = _nextParams;
        uint256 from = block.timestamp < start ? 0 : now_ + 1;
        if (from == 0) {
            _params = p;
            nextParamsFrom = type(uint256).max;
        } else {
            _nextParams = p;
            nextParamsFrom = from;
        }
        emit ParamsQueued(p, from);
    }

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    function setKeeper(address k) external onlyOwner {
        if (k == address(0)) revert ZeroAddress();
        keeper = k;
        emit KeeperSet(k);
    }

    // ================================================================ internal

    function _validate(Params memory p) private pure {
        if (
            p.slots == 0 || p.slots > MAX_SLOTS || p.cutBps > MAX_CUT_BPS || p.entryFee > MAX_ENTRY_FEE || p.minBid == 0
                || p.minBid > MAX_MIN_BID || p.maxBid < p.minBid || p.quorum == 0
        ) revert BadParams();
    }

    function _clearVotes(uint256 epoch, address voter) private {
        address[] storage mine = _votedTokens[epoch][voter];
        for (uint256 i; i < mine.length; ++i) {
            address t = mine[i];
            uint256 v = votesOf[epoch][t][voter];
            candidates[epoch][t].votes -= uint128(v);
            votesOf[epoch][t][voter] = 0;
        }
        delete _votedTokens[epoch][voter];
        usedVotes[epoch][voter] = 0;
    }

    function _claim(uint256 epoch, address token, address to) private returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (!_epochs[epoch].finalized) revert NotFinalized();
        Candidate storage c = candidates[epoch][token];
        if (!c.won) revert NotWinner();
        if (claimed[epoch][token][msg.sender]) revert NothingToClaim();
        uint256 v = votesOf[epoch][token][msg.sender];
        if (v == 0) revert NothingToClaim();
        claimed[epoch][token][msg.sender] = true;
        amount = uint256(c.payout) * v / c.votes;
        emit Claimed(epoch, token, msg.sender, to, amount);
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
