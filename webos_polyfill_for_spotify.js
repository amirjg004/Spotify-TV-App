
/* webOS polyfill for testing on non-webOS environments.
   Provides minimal objects expected by spotifytv.js so it doesn't throw.
   This is only for local/testing; it fakes device behavior and network responses.
*/
(function(){
  if (window.__spotify_webos_polyfill_installed) return;
  window.__spotify_webos_polyfill_installed = true;
  console.info("[polyfill] installing webOS stubs for testing");

  if (!window.webOSSystem) {
    window.webOSSystem = {
      // minimal device info - tweak as needed
      deviceInfo: {
        modelName: "Vidaa-Emu",
        platform: "vidaajs",
        sdkVersion: "1.0.0",
        deviceId: "vidaademo-0001"
      },
      launchParams: {},
      country: "US",
      locale: "en-US",
      onClose: function(){},
      platformBack: function(){},
      // generic event emitter placeholder
      addEventListener: function(name, cb){ console.info("[polyfill] webOSSystem.addEventListener", name); },
      removeEventListener: function(name, cb){ }
    };
  }

  if (!window.webOS) {
    window.webOS = {
      service: {
        request: function(opts){
          // Accept either (uri, opts) or single opts object for legacy signatures
          var uri = opts && opts.service ? opts.service : (typeof opts === 'string' ? opts : (opts && opts.uri));
          var _opts = (opts && opts.params) ? opts : opts || {};
          console.info("[polyfill] webOS.service.request:", uri, _opts);
          // Provide a default async-ish success/failure path
          setTimeout(function(){
            if (_opts.onSuccess) {
              // Return a generic success object; apps expecting specific payloads may still fail.
              _opts.onSuccess({ returnValue: true, data: {} });
            }
          }, 5);
          return {
            cancel: function(){ console.info("[polyfill] request canceled", uri); }
          };
        }
      }
    };
  }

  // Ensure navigator and platform helpers some apps check
  try {
    if (!navigator.userAgent || navigator.userAgent.indexOf("Web0S") === -1) {
      Object.defineProperty(navigator, 'userAgent', {
        value: (navigator.userAgent || "") + " Web0S/1.0",
        configurable: true,
        writable: true
      });
    }
  } catch(e){ /* ignore */ }

  console.info("[polyfill] webOS stubs ready");
})();
