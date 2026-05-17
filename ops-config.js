(function configureNaavalOps() {
  const host = String(window.location.hostname || "").trim().toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "192.168.1.156"]);
  const isLocal = localHosts.has(host);
  const liveApiBaseUrl = "https://core-api-mu.vercel.app";
  const liveCarrierBaseUrl = "https://carrier-app-ebon.vercel.app";

  window.NAAVAL_API_BASE_URL = isLocal ? "" : liveApiBaseUrl;
  window.NAAVAL_GOOGLE_CLIENT_ID = "1028415030067-ku3djdd03fbt5k086gnm19crhgumom55.apps.googleusercontent.com";
  window.NAAVAL_GOOGLE_MAPS_EMBED_KEY = "";
  window.NAAVAL_GOOGLE_ONE_TAP = false;
  window.NAAVAL_MAP_PROVIDER = "google";
  window.NAAVAL_CARRIER_BASE_URL = isLocal ? "" : liveCarrierBaseUrl;
  window.NAAVAL_CARRIER_INSTALL_URL = isLocal ? "" : `${liveCarrierBaseUrl}/install`;
})();
