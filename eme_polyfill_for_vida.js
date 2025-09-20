
// eme_polyfill_for_vida.js
// Polyfill to improve EME (DRM) negotiation attempts in environments where
// the app expects specific robustness values or multiple negotiation tries.
// Place this file before the Spotify bundle in your tvapp HTML.
// NOTE: This does NOT provide a real CDM or license. It only helps the app
// negotiate with the browser's native CDM by retrying with common robustnesses.
// If the license server rejects requests because of missing credentials or device
// registration, real playback will still fail.
(function(){
  if (window.__eme_polyfill_installed) return;
  window.__eme_polyfill_installed = true;
  console.info("[eme_polyfill] installing");

  const origRequest = navigator.requestMediaKeySystemAccess && navigator.requestMediaKeySystemAccess.bind(navigator);

  // helper: try origRequest with provided config, return promise
  function tryOrig(keySystem, config) {
    if (!origRequest) return Promise.reject(new Error("No native requestMediaKeySystemAccess available"));
    try {
      return origRequest(keySystem, config);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  navigator.requestMediaKeySystemAccess = function(keySystem, supportedConfigurations){
    console.info("[eme_polyfill] requestMediaKeySystemAccess called", keySystem, supportedConfigurations);
    // If there is a native implementation, try it first with the provided configs.
    if (origRequest) {
      return tryOrig(keySystem, supportedConfigurations).catch(origErr => {
        console.warn("[eme_polyfill] native request failed:", origErr);
        // Build fallback configurations to retry with common robustness variants
        const fallbackConfigs = (supportedConfigurations && supportedConfigurations.length) ? supportedConfigurations : [{
          initDataTypes: ["cenc","webm"],
          audioCapabilities: [{contentType: 'audio/mp4; codecs=\"mp4a.40.2\"'}],
          videoCapabilities: [{contentType: 'video/mp4; codecs=\"avc1.42E01E\"'}],
          persistentState: "optional",
          distinctiveIdentifier: "optional"
        }];

        const robustnessVariants = [
          "HW_SECURE_ALL",
          "HW_SECURE_CRYPTO",
          "HW_SECURE_DECODE",
          "SW_SECURE_DECODE",
          "SW_SECURE_CRYPTO",
          ""
        ];

        // Create a sequence of tries by appending robustness variants to videoCapabilities
        const tries = [];
        fallbackConfigs.forEach(cfg => {
          const base = JSON.parse(JSON.stringify(cfg));
          // If videoCapabilities not defined, ensure it's present
          if (!base.videoCapabilities || !base.videoCapabilities.length) {
            base.videoCapabilities = [{contentType: 'video/mp4; codecs=\"avc1.42E01E\"'}];
          }
          robustnessVariants.forEach(r => {
            const copy = JSON.parse(JSON.stringify(base));
            copy.videoCapabilities = copy.videoCapabilities.map(vc => {
              const out = Object.assign({}, vc);
              if (r) out.robustness = r;
              return out;
            });
            tries.push([keySystem, [copy]]);
          });
        });

        // sequentially try each candidate until one resolves
        let chain = Promise.reject();
        tries.forEach(([ks, conf]) => {
          chain = chain.catch(() => {
            console.info("[eme_polyfill] trying fallback robustness for", ks, conf[0].videoCapabilities.map(v=>v.robustness));
            return tryOrig(ks, conf);
          });
        });
        // If all fail, return original error
        return chain.catch(err => {
          console.error("[eme_polyfill] all negotiation attempts failed:", err);
          throw err;
        });
      });
    } else {
      // No native request available — cannot negotiate real DRM here
      console.warn("[eme_polyfill] no native requestMediaKeySystemAccess available on this platform");
      return Promise.reject(new Error("No native requestMediaKeySystemAccess available"));
    }
  };

  console.info("[eme_polyfill] installed");
})();
