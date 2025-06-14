const socket = io();
const username = localStorage.getItem('username');
const urlParams = new URLSearchParams(window.location.search);
const partner = urlParams.get('with');
document.getElementById('partner').innerText = partner;

if (!username || !partner) location.href = 'index.html';

let sharedKey;
let messagesUl = document.getElementById('messages');

(async () => {
  const keys = await window.crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, true, ["deriveKey"]);

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  socket.emit("ecdh:exchange", { to: partner, from: username, pub: publicKeyJwk });

  socket.on("ecdh:exchange", async data => {
    if (data.to !== username) return;
    const partnerKey = await crypto.subtle.importKey("jwk", data.pub, { name: "ECDH", namedCurve: "P-256" }, true, []);
    sharedKey = await crypto.subtle.deriveKey({ name: "ECDH", public: partnerKey }, keys.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  });
})();

socket.on("privateMessage", async data => {
  if (data.to !== username || data.from !== partner) return;
  const decrypted = await decryptMessage(data.text, data.iv);
  addMessage(data.from + ": " + decrypted);
});

function addMessage(text) {
  const li = document.createElement("li");
  li.innerText = text;
  messagesUl.appendChild(li);
}

async function encryptMessage(text) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, enc.encode(text));
  return { ct: Array.from(new Uint8Array(ct)), iv: Array.from(iv) };
}

async function decryptMessage(ctArray, ivArray) {
  const dec = new TextDecoder();
  const ct = new Uint8Array(ctArray);
  const iv = new Uint8Array(ivArray);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ct);
  return dec.decode(pt);
}

// Pengiriman pesan
sendBtn.onclick = async () => {
  if (!sharedKey) return;
  const text = message.value;
  const { ct, iv } = await encryptMessage(text);
  socket.emit("privateMessage", { to: partner, from: username, text: ct, iv });
  addMessage("Saya: " + text);
  message.value = "";
};
