"""Rank the most traded Uniswap V4 pools on Elysium (last ~300k blocks) that Stoa's V4 adapter can use:
hooks on the allowlist, paired with HYPE, WHYPE or USDC, at least 5 distinct traders. Needs init_0xe2e105.json
(all Initialize events) next to it; writes v4top.json. Run: python3 -I v4_top_pools.py"""
import json,urllib.request,collections,concurrent.futures as cf
RPC="https://rpc.elysium.kinetiq.xyz"
def rpc(m,p):
    r=urllib.request.Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),headers={"content-type":"application/json","user-agent":"curl/8"})
    return json.load(urllib.request.urlopen(r,timeout=120))
PM="0xe2e105d3f7209a9da11f83ccf3e7398a753823f1"; S="0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
head=int(rpc("eth_blockNumber",[])["result"],16); span=300000
def get(b):
    for _ in range(4):
        try:
            x=rpc("eth_getLogs",[{"fromBlock":hex(b),"toBlock":hex(min(b+4999,head)),"address":PM,"topics":[S]}])
            if "result" in x: return x["result"]
        except Exception: pass
    return []
cnt=collections.Counter(); traders=collections.defaultdict(set)
with cf.ThreadPoolExecutor(12) as ex:
    for ls in ex.map(get,range(head-span,head,5000)):
        for l in ls:
            cnt[l["topics"][1]]+=1; traders[l["topics"][1]].add(l["topics"][2])
print("swaps",sum(cnt.values()),"pools",len(cnt))
I=json.load(open("init_0xe2e105.json"))
keys={}
for l in I:
    d=l["data"][2:]; fee=int(d[0:64],16); ts=int(d[64:128],16); ts=ts-2**256 if ts>2**255 else ts
    keys[l["topics"][1]]=dict(currency0="0x"+l["topics"][2][-40:],currency1="0x"+l["topics"][3][-40:],fee=fee,tickSpacing=ts,hooks="0x"+d[152:192])
ALLOW={"0x0000000000000000000000000000000000000000","0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec","0xe0def4221b9840a610d4e7d55812a79a6431a8ec","0x3ab88ddc3cf2a012af88b60828edb4553697e5dc","0xe928f2336051cbd5b9d4531c25eadd13f9a82aec","0xbacf71bf02b8cfe171853c5ec4a060ba2ac1e0cc","0x3ea9581a32a396f69b177b65b91149cf887beacc","0x00c002cdae688f39a90cf2ad74c59421c9502acc","0x0fa71294c909b11a0b805df4763ba576c69c2acc","0x10f11002b148be522005f9b5d666bef339392aec","0xb67656ce894ac93c0164d8490ad23161a77ee000"}
BASE={"0x0000000000000000000000000000000000000000","0xba876237b0f021a6c6d852d6c26e107997cc5e81","0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65"}
out=[]
for pid,n in cnt.most_common():
    k=keys.get(pid)
    if not k or k["hooks"] not in ALLOW: continue
    if k["currency0"] not in BASE and k["currency1"] not in BASE: continue
    if {k["currency0"],k["currency1"]}<=BASE: continue  # HYPE/USDC itself: deeper elsewhere
    if len(traders[pid])<5: continue
    out.append(dict(id=pid,swaps=n,traders=len(traders[pid]),**k))
    if len(out)>=60: break
print(len(out)); [print(o["swaps"],o["traders"],o["currency1"],o["hooks"][:10]) for o in out[:10]]
json.dump(out,open("v4top.json","w"),indent=1)
