// sp_playready_runtime_shim.js
// Place this <script> BEFORE vendors.*.js and spotifytv.js in the HTML.
// It rewrites license_url queries and retries playready -> widevine on 404.
(function(){
  if (window.__sp_playready_runtime_shim_installed) return;
  window.__sp_playready_runtime_shim_installed = true;
  console.info("[sp-shim] install playready↔widevine runtime shim");

  // --- Helper: normalize URL object from various inputs
  function normURL(url) {
    try { return new URL(url, location.href); } catch(e) { return null; }
  }

  // --- 1) Map requestMediaKeySystemAccess (best-effort)
  try {
    const origRMKSA = navigator.requestMediaKeySystemAccess && navigator.requestMediaKeySystemAccess.bind(navigator);
    if (origRMKSA) {
      navigator.requestMediaKeySystemAccess = function(keySystem, supportedConfigurations) {
        // If incoming keySystem explicitly asks for PlayReady, try Widevine instead.
        try {
          let wantPlayready = false;
          if (typeof keySystem === 'string' && /playready/i.test(keySystem)) wantPlayready = true;
          if (Array.isArray(keySystem) && keySystem.some(k => /playready/i.test(k))) wantPlayready = true;
          if (wantPlayready) {
            console.info("[sp-shim] requestMediaKeySystemAccess: mapping PlayReady -> com.widevine.alpha");
            return origRMKSA('com.widevine.alpha', supportedConfigurations);
          }
        } catch(e){ /* fallthrough */ }
        return origRMKSA(keySystem, supportedConfigurations);
      };
    } else {
      console.warn("[sp-shim] navigator.requestMediaKeySystemAccess missing");
    }
  } catch(e){
    console.warn("[sp-shim] failed to patch requestMediaKeySystemAccess", e);
  }

  // --- 2) fetch() override: rewrite melody license_url keysystem and fallback playready->widevine on 404
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    try {
      let req = input;
      let urlStr = (input instanceof Request) ? input.url : String(input);
      const u = normURL(urlStr);
      if (u) {
        // 2.a rewrite melody license_url?keysystem=... if it requests playready -> request widevine instead
        if (u.pathname.includes('/melody/v1/license_url')) {
          const ks = u.searchParams.get('keysystem');
          if (ks && /playready/i.test(ks)) {
            console.info("[sp-shim] rewrite melody license_url keysystem playready -> widevine");
            u.searchParams.set('keysystem', 'com.widevine.alpha');
            req = (input instanceof Request) ? new Request(u.toString(), input) : u.toString();
          }
        }

        // 2.b handle direct playready-license POST: attempt original, if 404 retry as widevine
        if (u.pathname.includes('/playready-license/')) {
          // do original fetch
          let resp = await origFetch(req, init);
          if (resp && resp.status === 404) {
            // retry with widevine path
            const alt = urlStr.replace('/playready-license/', '/widevine-license/');
            console.info("[sp-shim] playready-license 404 -> retrying with widevine:", alt);
            const altReq = (input instanceof Request) ? new Request(alt, input) : alt;
            return origFetch(altReq, init);
          }
          return resp;
        }
      }
    } catch(e) {
      console.warn("[sp-shim] fetch override error", e);
      // fallthrough to native fetch
    }
    return origFetch(input, init);
  };

  // --- 3) XHR interception (capture headers via setRequestHeader and emulate retry)
  (function(){
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
      this._sp_shim_method = method;
      // normalize absolute url if relative
      try { this._sp_shim_url = new URL(url, location.href).toString(); } catch(e) { this._sp_shim_url = url; }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      this._sp_shim_headers = this._sp_shim_headers || {};
      this._sp_shim_headers[name] = value;
      return origSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      try {
        const url = this._sp_shim_url || "";
        // If this is a playready-license call, intercept and try original -> on 404 try widevine
        if (url.includes('/playready-license/')) {
          const fetchOpts = {
            method: this._sp_shim_method || 'POST',
            body: body,
            credentials: (this.withCredentials ? 'include' : 'same-origin'),
            headers: Object.assign({}, this._sp_shim_headers || {})
          };
          // perform fetch
          fetch(url, fetchOpts).then(async resp => {
            if (resp.status === 404) {
              const alt = url.replace('/playready-license/','/widevine-license/');
              console.info("[sp-shim][XHR] playready 404 -> retrying widevine:", alt);
              return fetch(alt, fetchOpts);
            }
            return resp;
          }).then(async resp => {
            // emulate XHR response events
            this.status = resp.status;
            this.readyState = 4;
            try {
              const arr = new Uint8Array(await resp.arrayBuffer());
              this.response = arr;
              this.responseType = 'arraybuffer';
            } catch(e) {
              try { this.responseText = await resp.text(); } catch(e2){ this.responseText = ""; }
            }
            if (typeof this.onload === 'function') this.onload();
            if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          }).catch(err => {
            console.error("[sp-shim][XHR] fetch error:", err);
            this.status = 0;
            this.readyState = 4;
            if (typeof this.onerror === 'function') this.onerror(err);
            if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          });
          return;
        }

        // If melody license_url query present with playready, rewrite and allow original XHR pipeline to continue:
        if (url.includes('/melody/v1/license_url') && /keysystem=.*playready/i.test(url)) {
          const newUrl = url.replace(/keysystem=[^&]*/i, 'keysystem=com.widevine.alpha');
          console.info("[sp-shim][XHR] rewrite melody license_url qs:", url, "->", newUrl);
          // re-open with new URL then continue send:
          origOpen.apply(this, [this._sp_shim_method || 'GET', newUrl, true]);
          return origSend.apply(this, [body]);
        }

      } catch(e){
        console.warn("[sp-shim][XHR] error in send shim", e);
      }
      return origSend.apply(this, arguments);
    };
  })();

  console.info("[sp-shim] installed");
})();
