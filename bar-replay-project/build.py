#!/usr/bin/env python3
"""Build every Bar Replay deliverable into dist/.

  dist/bar-replay.html               claude.ai artifact version (CSV replay, single file, chart lib from CDN)
  dist/bar-replay-extension/ (+zip)  Chrome extension, MV3 (live data + Google sign-in)
  dist/bar-replay-website/  (+zip)   static website for GitHub Pages (live data + Google sign-in)

Needs: Python 3 + Pillow (pip install pillow)
"""
import os, shutil, json
from PIL import Image, ImageDraw
ROOT=os.path.dirname(os.path.abspath(__file__))+'/'
S=ROOT+'src/'; V=ROOT+'vendor/'; K=ROOT+'keys/'; D=ROOT+'dist/'
os.makedirs(D,exist_ok=True)
CDN='https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js'

# ---------- 1) claude.ai artifact version (v1: CSV replay, inline JS) ----------
_t=open(S+'template_web_v1.html').read(); _js=open(S+'replay_web_v1.js').read()
open(D+'bar-replay.html','w').write(_t.replace('{{SCRIPTS}}',f'<script src="{CDN}"></script>\n<script>\n{_js}\n</script>'))
print('built artifact page')

# ---------- 2) Chrome extension ----------
tpl=open(S+'template_ext.html').read()
ext=D+'bar-replay-extension'
shutil.rmtree(ext,ignore_errors=True); os.makedirs(ext+'/icons')
scripts='\n'.join(f'<script src="{f}"></script>' for f in ['lightweight-charts.standalone.production.js','config.js','auth.js','data.js','cbdr.js','replay.js'])
open(ext+'/replay.html','w').write(tpl.replace('{{SCRIPTS}}',scripts))
shutil.copy(S+'replay_ext.js',ext+'/replay.js'); shutil.copy(S+'auth.js',ext); shutil.copy(S+'data.js',ext); shutil.copy(S+'cbdr.js',ext)
shutil.copy(V+'lightweight-charts.standalone.production.js',ext)
shutil.copy(V+'LICENSE-lightweight-charts.txt',ext)
open(ext+'/config.js','w').write("""// Bar Replay settings for the extension owner.
// 1. Create a Google OAuth client ID (type: Web application) in Google Cloud Console.
// 2. Add this authorised redirect URI to it:  https://odiolklmlggafpajcjkhjncimmgbccad.chromiumapp.org/
// 3. Paste the client ID between the quotes below, save, then reload the extension in chrome://extensions.
window.BR_CONFIG = {
  googleClientId: ''   // e.g. '1234567890-abc123.apps.googleusercontent.com'
};
""")
open(ext+'/background.js','w').write("chrome.action.onClicked.addListener(() => {\n  chrome.tabs.create({ url: chrome.runtime.getURL('replay.html') });\n});\n")
man={"manifest_version":3,"name":"Bar Replay","version":"2.0.0",
 "description":"Replay and trade live gold charts candle by candle, with UT Bot signals, practice trades and Google sign-in.",
 "key":open(K+'ext_key.b64').read().strip(),
 "action":{"default_title":"Open Bar Replay","default_icon":{s:f"icons/icon{s}.png" for s in ("16","32","48")}},
 "icons":{s:f"icons/icon{s}.png" for s in ("16","32","48","128")},
 "background":{"service_worker":"background.js"},
 "permissions":["identity","storage"],
 "host_permissions":["https://data-api.binance.vision/*","https://api.binance.com/*","https://api.twelvedata.com/*","https://www.googleapis.com/*"]}
open(ext+'/manifest.json','w').write(json.dumps(man,indent=2))
Z=512; im=Image.new('RGBA',(Z,Z),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rounded_rectangle([0,0,Z-1,Z-1],radius=110,fill=(14,26,40,255)); brass=(216,170,69,255)
d.polygon([(150,120),(150,392),(345,256)],fill=brass); d.rounded_rectangle([362,120,402,392],radius=12,fill=brass)
for s in (16,32,48,128): im.resize((s,s),Image.LANCZOS).save(f'{ext}/icons/icon{s}.png')
shutil.copy(S+'README_extension.txt',ext+'/README.txt')
shutil.make_archive(D+'bar-replay-extension','zip',D,'bar-replay-extension')
print('built extension')

# ---------- 3) Website (GitHub Pages) ----------
t=open(S+'template_ext.html').read()
def rep(a,b):
    global t
    assert t.count(a)==1, a[:70]; t=t.replace(a,b)
# head: PWA bits
rep('<title>Bar Replay</title>','''<title>Bar Replay</title>
<meta name="theme-color" content="#0E1A28">
<meta name="description" content="Replay and practise-trade live gold charts candle by candle, with UT Bot signals.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Bar Replay">''')
rep('.google{width:100%;min-height:52px;font-size:1.1rem;background:var(--text);color:var(--bg);border-color:transparent}',
    '.gbtn{display:flex;justify-content:center;min-height:44px}')
rep('<button type="button" class="google" id="googleBtn" hidden>Continue with Google</button>','<div class="gbtn" id="googleBtn" hidden></div>')
rep('''        <li>In Google Cloud Console, open APIs &amp; Services → Credentials and create an OAuth client ID of type <b>Web application</b>.</li>
        <li>Add this authorised redirect URI: <code id="redirUri"></code></li>
        <li>On the OAuth consent screen, choose External, keep the email, profile and openid scopes, and add your users as testers (or publish the app).</li>
        <li>Paste the client ID into <code>config.js</code> in the extension folder, then reload the extension.</li>''',
'''        <li>In Google Cloud Console, open APIs &amp; Services → Credentials and create (or open) an OAuth client ID of type <b>Web application</b>.</li>
        <li>Under Authorised JavaScript origins, add: <code id="originUri"></code></li>
        <li>On the OAuth consent screen, choose External, keep the email, profile and openid scopes, and add your users as testers (or publish the app).</li>
        <li>Paste the client ID into <code>config.js</code> on your site, then reload this page.</li>''')
web=D+'bar-replay-website'
shutil.rmtree(web,ignore_errors=True); os.makedirs(web)
scripts='\n'.join(f'<script src="{f}"></script>' for f in ['lightweight-charts.standalone.production.js','config.js','auth.js','data.js','cbdr.js','replay.js'])
open(web+'/index.html','w').write(t.replace('{{SCRIPTS}}',scripts))
shutil.copy(S+'replay_ext.js',web+'/replay.js'); shutil.copy(S+'auth_web.js',web+'/auth.js'); shutil.copy(S+'data.js',web+'/data.js'); shutil.copy(S+'cbdr.js',web+'/cbdr.js')
shutil.copy(V+'lightweight-charts.standalone.production.js',web)
shutil.copy(V+'LICENSE-lightweight-charts.txt',web)
open(web+'/config.js','w').write("""// Bar Replay website settings.
// Paste your Google OAuth client ID (type: Web application) between the quotes,
// and add your site's address (e.g. https://yourname.github.io) to its Authorised JavaScript origins.
window.BR_CONFIG = {
  googleClientId: ''   // e.g. '1234567890-abc123.apps.googleusercontent.com'
};
""")
open(web+'/manifest.webmanifest','w').write(json.dumps({
 "name":"Bar Replay","short_name":"Bar Replay","start_url":"./","scope":"./","display":"standalone",
 "background_color":"#0E1A28","theme_color":"#0E1A28",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"},
          {"src":"icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]},indent=2))
def icon(S, pad=0, rounded=True):
    im=Image.new('RGBA',(S,S),(14,26,40,255) if not rounded else (0,0,0,0)); d=ImageDraw.Draw(im)
    if rounded: d.rounded_rectangle([0,0,S-1,S-1],radius=int(S*0.215),fill=(14,26,40,255))
    k=(S-2*pad)/512; o=pad; b=(216,170,69,255)
    d.polygon([(o+150*k,o+120*k),(o+150*k,o+392*k),(o+345*k,o+256*k)],fill=b)
    d.rounded_rectangle([o+362*k,o+120*k,o+402*k,o+392*k],radius=max(1,int(12*k)),fill=b)
    return im
big=icon(1024)
for n,s in (('icon-192.png',192),('icon-512.png',512),('favicon-32.png',32)): big.resize((s,s),Image.LANCZOS).save(web+'/'+n)
icon(1024,pad=160,rounded=False).resize((512,512),Image.LANCZOS).save(web+'/icon-maskable-512.png')
icon(1024,rounded=False).resize((180,180),Image.LANCZOS).save(web+'/apple-touch-icon.png')
shutil.copy(S+'README_website.txt',web+'/README.txt')
shutil.make_archive(D+'bar-replay-website','zip',D,'bar-replay-website')
print('built website')
