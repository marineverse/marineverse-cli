import { MARINEVERSE_LOGO } from './brand.js';

export type CallbackState = 'received' | 'denied' | 'invalid';

export function callbackPage(state: CallbackState): string {
  const success = state === 'received';
  const title = success ? 'Authorization received.' : state === 'denied' ? 'Authorization cancelled.' : 'Let’s try that again.';
  const description = success
    ? 'Return to your terminal to finish signing in to MarineVerse CLI. You can close this tab.'
    : state === 'denied' ? 'No access was granted. Return to your terminal whenever you’re ready to sign in.'
      : 'We couldn’t verify this login request. Return to your terminal and start a new sign-in.';
  const command = success ? 'marineverse auth status' : 'marineverse auth login';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>${title} | MarineVerse CLI</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#f3f8fc;color:#00284b;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column}
header{padding:32px 7vw;display:flex;align-items:center;gap:18px}header svg{width:225px;height:auto;display:block}.badge{font-size:12px;font-weight:700;letter-spacing:1.5px;border-left:1px solid #b8cedf;padding:8px 0 8px 18px;color:#416582}
main{flex:1;display:grid;place-items:center;padding:32px 24px 72px}.card{width:100%;max-width:600px;background:#fff;border:1px solid #dce8f1;border-radius:24px;box-shadow:0 20px 65px #00284b0b;overflow:hidden}.stripe{height:6px;background:linear-gradient(90deg,#0064c8,#0096e1)}.body{padding:48px}.icon{width:64px;height:64px;border-radius:50%;background:#e7f4fc;color:#0064c8;display:grid;place-items:center;margin-bottom:28px}.icon svg{width:30px;height:30px}.eyebrow{font-size:11px;letter-spacing:1.8px;font-weight:700;color:#0064c8;margin:0 0 12px}h1{font-size:34px;line-height:1.15;letter-spacing:-1px;margin:0 0 18px}p{color:#526d83;font-size:16px;line-height:1.7;margin:0}.terminal{margin-top:32px;background:#f3f8fc;border:1px solid #dce8f1;border-radius:12px;padding:20px}.terminal p{font-size:10px;letter-spacing:1.4px;font-weight:700;margin-bottom:10px;color:#52718b}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;overflow-wrap:anywhere}.prompt{color:#0096e1;margin-right:10px}.footnote{padding:20px 48px;border-top:1px solid #eaf0f5;font-size:12px;color:#6a8398;display:flex;align-items:center;gap:8px}.dot{width:6px;height:6px;border-radius:50%;background:#0096e1;flex-shrink:0}footer{padding:24px;text-align:center;font-size:12px;color:#6a8398;letter-spacing:.3px}.sea{width:100%;height:48px;display:block;flex-shrink:0}
@media(max-width:540px){header{padding:24px;gap:12px}header svg{width:185px}.badge{padding-left:12px}main{padding:12px 18px 40px}.body{padding:32px 26px}h1{font-size:29px}.footnote{padding:18px 26px}.terminal{padding:16px}code{font-size:12px}}
</style></head><body>
<header>${MARINEVERSE_LOGO}<span class="badge">CLI</span></header>
<main><section class="card" aria-labelledby="heading"><div class="stripe"></div><div class="body">
<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${success ? '<path d="m5 12 4 4L19 6"/>' : '<path d="m7 7 10 10M17 7 7 17"/>'}</svg></div>
<p class="eyebrow">MARINEVERSE CLI</p><h1 id="heading">${title}</h1><p>${description}</p>
<div class="terminal"><p>${success ? 'CHECK YOUR CONNECTION' : 'START A NEW SIGN-IN'}</p><code><span class="prompt" aria-hidden="true">$</span>${command}</code></div>
</div><div class="footnote"><span class="dot" aria-hidden="true"></span>${success ? 'Your next adventure starts in the terminal.' : 'Your MarineVerse account stays in your control.'}</div></section></main>
<footer>MarineVerse · Sail More Often</footer>
<svg class="sea" aria-hidden="true" viewBox="0 0 1440 48" preserveAspectRatio="none"><path fill="#dbeefb" d="M0 20Q180 0 360 22T720 20T1080 18T1440 24V48H0Z"/><path fill="#0064c8" d="M0 35Q180 15 360 36T720 34T1080 30T1440 38V48H0Z"/></svg>
</body></html>`;
}
