"use client";
import { useState } from "react";

/** Makes the key pair web push needs (VAPID, P-256), in this browser with WebCrypto: nothing is sent anywhere. The team
 *  pastes the two values into Vercel's environment variables once. */
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export default function PushKeys() {
  const [k, setK] = useState<{ pub: string; priv: string } | null>(null);
  const [copied, setCopied] = useState("");
  const make = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    setK({ pub: b64u(pub), priv: jwk.d ?? "" });
  };
  const copy = async (label: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(label); setTimeout(() => setCopied(""), 1500); } catch { /* select it by hand */ } };
  return (
    <div className="panel pad" style={{ marginTop: 20 }}>
      <div className="lbl">PUSH NOTIFICATION KEYS</div>
      <p className="note">Once, to switch on notifications: make a key pair here (in this browser, nothing is sent), then in Vercel → stoa → Settings → Environment Variables add <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> = the public key and <code>VAPID_PRIVATE_KEY</code> = the private key (Production), and redeploy. Keep the private key private, and never change the pair afterwards: every device would have to turn notifications on again.</p>
      {!k ? <button type="button" className="ghost" onClick={make}>Make a key pair</button> : (
        <div style={{ display: "grid", gap: 8 }}>
          <div><small className="note">Public key</small><div className="rowx" style={{ gap: 8 }}><code style={{ wordBreak: "break-all" }}>{k.pub}</code><button type="button" className="ghost" onClick={() => copy("pub", k.pub)}>{copied === "pub" ? "Copied" : "Copy"}</button></div></div>
          <div><small className="note">Private key (secret)</small><div className="rowx" style={{ gap: 8 }}><code style={{ wordBreak: "break-all", filter: "blur(4px)" }}>{k.priv}</code><button type="button" className="ghost" onClick={() => copy("priv", k.priv)}>{copied === "priv" ? "Copied" : "Copy"}</button></div></div>
        </div>
      )}
    </div>
  );
}
