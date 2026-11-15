// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StoaRouter} from "./StoaRouter.sol";

/// @title RugCover
/// @notice A Pons token's creator puts ETH behind a promise not to sell or move the tokens in their wallet. Buyers who
///         buy that token through Stoa with cover get the ETH they spent back if the creator's wallet drops below
///         what it held when the cover opened, at any moment before the creator releases the bond.
///         - The creator (the wallet the Pons factory records for the token) opens a term with a bond and a fee. The
///           floor is the creator's whole balance at that moment, at least `minFloorBps` of supply.
///         - Buyers call `buyCovered` with a Stoa router swap from ETH to the token, paid to themselves, plus a
///           premium. Their cover is the ETH that went into the swap. Cover sold in a term never exceeds
///           `capacityBps` of the bond (at most 75%), so the creator always forfeits at least a quarter of it.
///         - Anyone can call `breach` once the creator's balance is below the floor and earns a small bounty. Each
///           buyer then claims their cover in ETH. What is left of the bond goes to the burn pot and to backers.
///         - After the term plus a 24-hour grace the creator can `release` the bond, if the floor still holds.
///         - $STOA holders lock $STOA as backers and earn creator fees and forfeited bonds, streamed over 7 days.
///           Backers never pay for a breach. Buyer premiums are not shared with anyone: they go to the burn pot.
///         - The keeper spends the burn pot on $STOA through the Stoa router and sends it to 0x...dEaD.
/// @dev No function sends ETH or $STOA anywhere except to a buyer, a creator, a backer, a breach caller or the burn.
///      The guardian can only pause new terms, covered buys and locks; claims, breaches, releases, unlocks and
///      reward claims keep working, and while paused backers can take their $STOA out at once. Only the owner (the
///      48h timelock) unpauses and sets parameters, within fixed bounds, for terms opened afterwards.
contract RugCover is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    struct Params {
        uint32 term; // seconds a cover runs, MIN_TERM..MAX_TERM
        uint16 feeBps; // creator fee, share of the bond, <= MAX_FEE_BPS
        uint16 capacityBps; // cover a term can sell, share of the bond, 1..MAX_CAPACITY_BPS
        uint16 premiumBps; // buyer premium, share of the ETH swapped, <= MAX_PREMIUM_BPS
        uint16 walletCapBps; // one buyer's share of a term's capacity, 1..BPS
        uint16 bountyBps; // breach caller's share of the bond, <= MAX_BOUNTY_BPS
        uint16 burnBps; // burn share of creator fees and forfeited bonds, MIN_BURN_BPS..MAX_BURN_BPS
        uint16 minFloorBps; // smallest creator balance that can open a term, share of supply, 1..BPS
        uint64 minFee; // wei, the creator fee is never below this, <= MAX_MIN_FEE
        uint64 minBond; // wei, > 0
        uint64 maxBond; // wei, minBond..MAX_BOND
        uint64 minCover; // wei per covered buy, > 0
        uint64 maxCover; // wei per covered buy, >= minCover
        uint96 maxTotalBonds; // wei, all open bonds together, >= maxBond
    }

    struct Term {
        address creator;
        uint8 status; // OPEN, RELEASED or BREACHED
        uint64 openedAt;
        uint64 endsAt; // covered buys stop SALE_STOP before; release from endsAt + GRACE
        uint96 bond;
        uint96 capacity; // wei of cover this term can sell
        uint96 sold; // wei of cover sold
        uint128 floor; // the creator's token balance when the term opened
        // the rules this term runs on, copied when it opens
        uint16 premiumBps;
        uint16 walletCapBps;
        uint16 bountyBps;
        uint16 burnBps;
        uint64 minCover;
        uint64 maxCover;
    }

    struct Backer {
        uint128 active; // locked and earning
        uint128 pending; // waiting to be withdrawn, earns nothing
        uint64 unlockAt; // when `pending` can be withdrawn
    }

    // ---------------------------------------------------------------- constants

    uint8 public constant OPEN = 1;
    uint8 public constant RELEASED = 2;
    uint8 public constant BREACHED = 3;

    uint256 internal constant BPS = 10_000;
    /// @dev precision of rewardPerTokenStored: rewardRate is scaled by 1e18, rewardPerToken by 1e18 * 1e12
    uint256 internal constant ACC = 1e30;
    /// @notice covered buys stop this long before a term ends, so every cover runs at least a day
    uint256 public constant SALE_STOP = 1 days;
    /// @notice a bond can be released this long after its term ends; a dump at the last minute stays breachable
    uint256 public constant GRACE = 1 days;
    /// @notice backer income is paid out evenly over this long
    uint256 public constant STREAM = 7 days;
    /// @notice locked $STOA can be withdrawn this long after an unlock is requested
    uint256 public constant UNLOCK_DELAY = 7 days;

    uint256 public constant MIN_TERM = 2 days;
    uint256 public constant MAX_TERM = 30 days;
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @dev at most 75% of a bond can be sold as cover, so a creator who buys their own cover and breaches always
    ///      forfeits at least 25% of it, of which at least MIN_BURN_BPS is burned whoever the backers are
    uint16 public constant MAX_CAPACITY_BPS = 7500;
    uint16 public constant MAX_PREMIUM_BPS = 500;
    uint16 public constant MAX_BOUNTY_BPS = 200;
    uint16 public constant MIN_BURN_BPS = 1000;
    uint16 public constant MAX_BURN_BPS = 2000;
    uint256 public constant MAX_MIN_FEE = 0.01 ether;
    uint256 public constant MAX_BOND = 10 ether;

    /// PonsFactory.getLaunchedToken(address): a struct whose first three words are (token, curve, creator)
    bytes4 internal constant GET_LAUNCHED = 0x3cf28b5a;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    address public constant NATIVE = address(0);

    // ---------------------------------------------------------------- state

    IERC20 public immutable stoa;
    StoaRouter public immutable router;
    address public immutable ponsFactory;

    address public guardian;
    address public keeper;
    bool public paused;

    Params internal _params;

    /// @notice the latest term id of a token (0 = never covered); terms are numbered from 1
    mapping(address token => uint256) public termCount;
    mapping(address token => mapping(uint256 id => Term)) internal _terms;
    /// @notice ETH of cover a buyer holds in a term (zeroed when claimed)
    mapping(address token => mapping(uint256 id => mapping(address buyer => uint256))) public coverOf;

    address[] internal _openTokens;
    mapping(address token => uint256) internal _openIndex; // position in _openTokens + 1

    /// @notice bonds of open terms
    uint256 public totalBonds;
    /// @notice cover of breached terms not claimed yet
    uint256 public totalOwed;
    /// @notice ETH waiting to be spent on $STOA and burned
    uint256 public burnPot;
    /// @notice $STOA bought with the burn pot and burned so far
    uint256 public totalBurned;
    /// @notice breach bounties not withdrawn yet
    mapping(address => uint256) public credits;
    uint256 public totalCredits;

    mapping(address => Backer) public backers;
    /// @notice $STOA locked and earning
    uint256 public totalActive;
    /// @notice $STOA held for backers (active + pending)
    uint256 public totalLocked;
    /// @notice backer income streamed per second, in wei scaled by 1e18
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdate;
    /// @notice wei earned per $STOA wei since deployment, scaled by ACC (fine enough that a few hundred million
    ///         locked $STOA lose no more than a wei to rounding per update)
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public rewardPaid;
    mapping(address => uint256) public rewards;

    // ---------------------------------------------------------------- events

    event Opened(
        address indexed token,
        uint256 indexed id,
        address indexed creator,
        uint256 bond,
        uint256 fee,
        uint256 floor,
        uint256 endsAt,
        uint256 capacity
    );
    event Covered(
        address indexed token, uint256 indexed id, address indexed buyer, uint256 cover, uint256 premium, uint256 out
    );
    event Breached(
        address indexed token, uint256 indexed id, address indexed caller, uint256 owed, uint256 bounty, uint256 rest
    );
    event Released(address indexed token, uint256 indexed id, address to, uint256 bond);
    event Claimed(address indexed token, uint256 indexed id, address indexed buyer, address to, uint256 amount);
    event CreditWithdrawn(address indexed who, address to, uint256 amount);
    event Income(uint256 toBackers, uint256 toBurnPot);
    event Locked(address indexed backer, uint256 amount);
    event UnlockRequested(address indexed backer, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed backer, address to, uint256 amount);
    event EmergencyWithdrawn(address indexed backer, address to, uint256 amount);
    event RewardPaid(address indexed backer, address to, uint256 amount);
    event Burned(uint256 ethIn, uint256 stoaBurned);
    event ParamsSet(Params params);
    event Paused(bool paused);
    event GuardianSet(address guardian);
    event KeeperSet(address keeper);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error ZeroAmount();
    error BadAmount();
    error BadParams();
    error BadBond();
    error BadValue();
    error BadSwap();
    error BadCover();
    error NotCreator();
    error TermOpen();
    error BondCap();
    error FloorTooLow();
    error NoCover();
    error SalesClosed();
    error CreatorCannotBuy();
    error CapacityFull();
    error WalletCap();
    error Breachable();
    error NotBreached();
    error TooEarly();
    error NothingToClaim();
    error NotPaused();
    error IsPaused();
    error NotGuardian();
    error NotKeeper();
    error SendFailed();
    error NoRenounce();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(
        address owner_,
        StoaRouter router_,
        IERC20 stoa_,
        address ponsFactory_,
        address guardian_,
        address keeper_,
        Params memory params_
    ) Ownable(owner_) {
        if (
            address(router_) == address(0) || address(stoa_) == address(0) || ponsFactory_ == address(0)
                || guardian_ == address(0) || keeper_ == address(0)
        ) revert ZeroAddress();
        _checkParams(params_);
        router = router_;
        stoa = stoa_;
        ponsFactory = ponsFactory_;
        guardian = guardian_;
        keeper = keeper_;
        _params = params_;
        lastUpdate = block.timestamp;
    }

    // ================================================================ creators

    /// @notice Open a cover term for `token`, which the Pons factory says the caller created. Send `bond` plus
    ///         `feeFor(bond)`. The floor is the caller's whole token balance now.
    function open(address token, uint256 bond) external payable nonReentrant whenNotPaused returns (uint256 id) {
        Params memory p = _params;
        if (bond < p.minBond || bond > p.maxBond) revert BadBond();
        uint256 fee = feeFor(bond);
        if (msg.value != bond + fee) revert BadValue();
        if (creatorOf(token) != msg.sender) revert NotCreator();
        uint256 last = termCount[token];
        if (last != 0 && _terms[token][last].status == OPEN) revert TermOpen();
        if (totalBonds + bond > p.maxTotalBonds) revert BondCap();
        uint256 bal = IERC20(token).balanceOf(msg.sender);
        if (bal == 0 || bal * BPS < IERC20(token).totalSupply() * p.minFloorBps) revert FloorTooLow();

        id = last + 1;
        termCount[token] = id;
        uint256 endsAt = block.timestamp + p.term;
        uint256 capacity = bond * p.capacityBps / BPS;
        _terms[token][id] = Term({
            creator: msg.sender,
            status: OPEN,
            openedAt: uint64(block.timestamp),
            endsAt: uint64(endsAt),
            bond: uint96(bond),
            capacity: uint96(capacity),
            sold: 0,
            floor: uint128(bal),
            premiumBps: p.premiumBps,
            walletCapBps: p.walletCapBps,
            bountyBps: p.bountyBps,
            burnBps: p.burnBps,
            minCover: p.minCover,
            maxCover: p.maxCover
        });
        totalBonds += bond;
        _openTokens.push(token);
        _openIndex[token] = _openTokens.length;
        _income(fee, p.burnBps);
        emit Opened(token, id, msg.sender, bond, fee, bal, endsAt, capacity);
    }

    /// @notice Take the bond back, from 24 hours after the term ends, if the creator's balance still holds the floor.
    function release(address token, address to) external nonReentrant returns (uint256 bond) {
        if (to == address(0)) revert ZeroAddress();
        uint256 id = termCount[token];
        Term storage t = _terms[token][id];
        if (id == 0 || t.status != OPEN) revert NoCover();
        if (msg.sender != t.creator) revert NotCreator();
        if (block.timestamp < uint256(t.endsAt) + GRACE) revert TooEarly();
        if (IERC20(token).balanceOf(t.creator) < t.floor) revert Breachable();
        t.status = RELEASED;
        _removeOpen(token);
        bond = t.bond;
        totalBonds -= bond;
        _send(to, bond);
        emit Released(token, id, to, bond);
    }

    // ================================================================ buyers

    /// @notice Buy `s.tokenOut` with ETH through the Stoa router, covered by its open term. `s` is a router swap from
    ///         ETH (NATIVE) to the token paid to the caller; send `s.amountIn` plus `premiumFor(token, s.amountIn)`.
    ///         The cover is `s.amountIn`: claimable in ETH if the term is breached.
    function buyCovered(StoaRouter.SwapParams calldata s)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        if (s.tokenIn != NATIVE || s.to != msg.sender) revert BadSwap();
        address token = s.tokenOut;
        uint256 id = termCount[token];
        Term storage t = _terms[token][id];
        if (id == 0 || t.status != OPEN) revert NoCover();
        if (block.timestamp + SALE_STOP > t.endsAt) revert SalesClosed();
        if (msg.sender == t.creator) revert CreatorCannotBuy();
        if (IERC20(token).balanceOf(t.creator) < t.floor) revert Breachable();
        uint256 cover = s.amountIn;
        if (cover < t.minCover || cover > t.maxCover) revert BadCover();
        uint256 premium = cover * t.premiumBps / BPS;
        if (msg.value != cover + premium) revert BadValue();
        uint256 sold = uint256(t.sold) + cover;
        if (sold > t.capacity) revert CapacityFull();
        uint256 mine = coverOf[token][id][msg.sender] + cover;
        if (mine * BPS > uint256(t.capacity) * t.walletCapBps) revert WalletCap();

        t.sold = uint96(sold);
        coverOf[token][id][msg.sender] = mine;
        burnPot += premium;
        amountOut = router.swap{value: cover}(s);
        emit Covered(token, id, msg.sender, cover, premium, amountOut);
    }

    /// @notice After a breach, take the ETH of your cover in that term.
    function claim(address token, uint256 id, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (_terms[token][id].status != BREACHED) revert NotBreached();
        amount = coverOf[token][id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        coverOf[token][id][msg.sender] = 0;
        totalOwed -= amount;
        _send(to, amount);
        emit Claimed(token, id, msg.sender, to, amount);
    }

    // ================================================================ anyone

    /// @notice End `token`'s open term as breached: its creator's balance is below the floor. Reserves every
    ///         buyer's cover, pays the caller the bounty (withdraw it with `withdrawCredit`) and sends the rest of the
    ///         bond to the burn pot and backers.
    function breach(address token) external nonReentrant returns (uint256 bounty) {
        uint256 id = termCount[token];
        Term storage t = _terms[token][id];
        if (id == 0 || t.status != OPEN) revert NoCover();
        if (IERC20(token).balanceOf(t.creator) >= t.floor) revert NotBreached();
        t.status = BREACHED;
        _removeOpen(token);
        uint256 bond = t.bond;
        uint256 owed = t.sold;
        totalBonds -= bond;
        totalOwed += owed;
        bounty = bond * t.bountyBps / BPS;
        credits[msg.sender] += bounty;
        totalCredits += bounty;
        uint256 rest = bond - owed - bounty; // owed <= 75% and bounty <= 2% of the bond
        _income(rest, t.burnBps);
        emit Breached(token, id, msg.sender, owed, bounty, rest);
    }

    function withdrawCredit(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = credits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        credits[msg.sender] = 0;
        totalCredits -= amount;
        _send(to, amount);
        emit CreditWithdrawn(msg.sender, to, amount);
    }

    // ================================================================ backers

    function lock(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        _update(msg.sender);
        stoa.safeTransferFrom(msg.sender, address(this), amount);
        backers[msg.sender].active += uint128(amount);
        totalActive += amount;
        totalLocked += amount;
        emit Locked(msg.sender, amount);
    }

    /// @notice Stop earning on `amount` of your locked $STOA; withdraw it UNLOCK_DELAY later. A matured earlier
    ///         request is paid out to you first, so the new delay never holds $STOA that was already free.
    function requestUnlock(uint256 amount) external nonReentrant {
        Backer storage b = backers[msg.sender];
        if (amount == 0 || amount > b.active) revert BadAmount();
        _update(msg.sender);
        if (b.pending != 0 && block.timestamp >= b.unlockAt) _payPending(b, msg.sender);
        b.active -= uint128(amount);
        totalActive -= amount;
        b.pending += uint128(amount);
        b.unlockAt = uint64(block.timestamp + UNLOCK_DELAY);
        emit UnlockRequested(msg.sender, amount, b.unlockAt);
    }

    function withdraw(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        Backer storage b = backers[msg.sender];
        if (b.pending == 0) revert NothingToClaim();
        if (block.timestamp < b.unlockAt) revert TooEarly();
        amount = _payPending(b, to);
    }

    /// @notice While paused, take all your $STOA out at once. Rewards earned so far stay claimable.
    function emergencyWithdraw(address to) external nonReentrant returns (uint256 amount) {
        if (!paused) revert NotPaused();
        if (to == address(0)) revert ZeroAddress();
        _update(msg.sender);
        Backer storage b = backers[msg.sender];
        amount = uint256(b.active) + b.pending;
        if (amount == 0) revert NothingToClaim();
        totalActive -= b.active;
        totalLocked -= amount;
        b.active = 0;
        b.pending = 0;
        stoa.safeTransfer(to, amount);
        emit EmergencyWithdrawn(msg.sender, to, amount);
    }

    function claimRewards(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        _update(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        rewards[msg.sender] = 0;
        _send(to, amount);
        emit RewardPaid(msg.sender, to, amount);
    }

    // ================================================================ keeper

    /// @notice Spend the burn pot on $STOA through the Stoa router and send it to 0x...dEaD. Keeper or owner only,
    ///         with a minimum output set from a fresh quote, so the burn cannot be sandwiched cheaply.
    function burn(address mid, StoaRouter.Leg calldata leg1, StoaRouter.Leg calldata leg2, uint256 minOut)
        external
        nonReentrant
        returns (uint256 burned)
    {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _update(address(0)); // moves what streamed while nobody was locked into the pot
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

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice New rules for terms opened from now on; open terms keep the rules they opened with.
    function setParams(Params calldata p) external onlyOwner {
        _checkParams(p);
        _params = p;
        emit ParamsSet(p);
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

    function renounceOwnership() public pure override {
        revert NoRenounce();
    }

    // ================================================================ views

    function params() external view returns (Params memory) {
        return _params;
    }

    function feeFor(uint256 bond) public view returns (uint256 fee) {
        fee = bond * _params.feeBps / BPS;
        if (fee < _params.minFee) fee = _params.minFee;
    }

    /// @notice the premium a covered buy of `cover` wei pays on `token`'s open term (0 when none is open)
    function premiumFor(address token, uint256 cover) external view returns (uint256) {
        Term storage t = _terms[token][termCount[token]];
        return t.status == OPEN ? cover * t.premiumBps / BPS : 0;
    }

    function term(address token, uint256 id) external view returns (Term memory) {
        return _terms[token][id];
    }

    /// @notice the token's latest term (id 0 and an empty term when it was never covered)
    function latestTerm(address token) external view returns (uint256 id, Term memory t) {
        id = termCount[token];
        t = _terms[token][id];
    }

    /// @notice true when `token` has an open term whose creator's balance is below the floor
    function breachable(address token) public view returns (bool) {
        Term storage t = _terms[token][termCount[token]];
        return t.status == OPEN && IERC20(token).balanceOf(t.creator) < t.floor;
    }

    /// @notice tokens with an open term, for the keeper and the web
    function openTokens() external view returns (address[] memory) {
        return _openTokens;
    }

    /// @notice the creator the Pons factory records for `token`, or address(0) when it is not a Pons launch
    function creatorOf(address token) public view returns (address creator) {
        (bool ok, bytes memory r) = ponsFactory.staticcall(abi.encodeWithSelector(GET_LAUNCHED, token));
        if (!ok || r.length < 96) return address(0);
        address launched;
        assembly {
            launched := and(mload(add(r, 32)), 0xffffffffffffffffffffffffffffffffffffffff)
            creator := and(mload(add(r, 96)), 0xffffffffffffffffffffffffffffffffffffffff)
        }
        if (launched != token) return address(0);
    }

    function rewardPerToken() public view returns (uint256) {
        uint256 t = _lastApplicable();
        if (totalActive == 0 || t <= lastUpdate) return rewardPerTokenStored;
        return rewardPerTokenStored + (t - lastUpdate) * rewardRate * 1e12 / totalActive;
    }

    /// @notice ETH a backer can claim now
    function earned(address backer) public view returns (uint256) {
        return rewards[backer] + uint256(backers[backer].active) * (rewardPerToken() - rewardPaid[backer]) / ACC;
    }

    /// @notice backer income still to stream
    function unstreamed() external view returns (uint256) {
        return block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate / 1e18 : 0;
    }

    // ================================================================ internal

    function _lastApplicable() internal view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function _update(address account) internal {
        uint256 t = _lastApplicable();
        if (t > lastUpdate) {
            if (totalActive == 0) {
                // nobody was earning: what streamed in this gap is burned instead
                burnPot += (t - lastUpdate) * rewardRate / 1e18;
            } else {
                rewardPerTokenStored += (t - lastUpdate) * rewardRate * 1e12 / totalActive;
            }
            lastUpdate = t;
        }
        if (account != address(0)) {
            rewards[account] = earned(account);
            rewardPaid[account] = rewardPerTokenStored;
        }
    }

    /// @dev Creator fees and forfeited bonds: `burnBps` to the burn pot, the rest streamed to backers (or burned too
    ///      when nobody is locked).
    function _income(uint256 amount, uint256 burnBps) internal {
        if (amount == 0) return;
        uint256 toBurn = amount * burnBps / BPS;
        uint256 toBackers = amount - toBurn;
        _update(address(0));
        if (totalActive == 0) {
            toBurn += toBackers;
            toBackers = 0;
        } else {
            uint256 scaled = toBackers * 1e18;
            if (block.timestamp < periodFinish) scaled += (periodFinish - block.timestamp) * rewardRate;
            rewardRate = scaled / STREAM;
            lastUpdate = block.timestamp;
            periodFinish = block.timestamp + STREAM;
        }
        burnPot += toBurn;
        emit Income(toBackers, toBurn);
    }

    function _payPending(Backer storage b, address to) internal returns (uint256 amount) {
        amount = b.pending;
        b.pending = 0;
        totalLocked -= amount;
        stoa.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function _removeOpen(address token) internal {
        uint256 i = _openIndex[token];
        uint256 last = _openTokens.length;
        if (i != last) {
            address moved = _openTokens[last - 1];
            _openTokens[i - 1] = moved;
            _openIndex[moved] = i;
        }
        _openTokens.pop();
        delete _openIndex[token];
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
    }

    function _checkParams(Params memory p) internal pure {
        if (
            p.term < MIN_TERM || p.term > MAX_TERM || p.feeBps > MAX_FEE_BPS || p.capacityBps == 0
                || p.capacityBps > MAX_CAPACITY_BPS || p.premiumBps > MAX_PREMIUM_BPS || p.walletCapBps == 0
                || p.walletCapBps > BPS || p.bountyBps > MAX_BOUNTY_BPS || p.burnBps < MIN_BURN_BPS
                || p.burnBps > MAX_BURN_BPS || p.minFloorBps == 0 || p.minFloorBps > BPS || p.minFee > MAX_MIN_FEE
                || p.minBond == 0 || p.maxBond < p.minBond || p.maxBond > MAX_BOND || p.minCover == 0
                || p.maxCover < p.minCover || p.maxTotalBonds < p.maxBond
        ) revert BadParams();
    }
}
