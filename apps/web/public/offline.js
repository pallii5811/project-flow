/* global window, document, fetch */
// The offline page's only script (offline-shell.html, served by the service
// worker when a page cannot be reached). The address bar still holds the page
// the viewer asked for: Try again reloads it, and so does the network coming
// back. No framework, nothing else to fetch.
(function () {
  var retry = document.querySelector("[data-offline-retry]");
  if (retry) {
    retry.setAttribute("href", window.location.href);
    retry.addEventListener("click", function (event) {
      event.preventDefault();
      window.location.reload();
    });
  }

  // "online" is not enough: a phone can say it is online while nothing gets
  // through (a captive portal, a dead cell). The page asks the network itself,
  // with a HEAD the worker leaves alone, and reloads the moment it answers.
  var wait = 3000;
  var timer = null;
  function probe() {
    timer = null;
    fetch(window.location.href, { method: "HEAD", cache: "no-store" })
      .then(function (response) {
        if (response.ok || response.status === 404) window.location.reload();
        else schedule();
      })
      .catch(schedule);
  }
  function schedule() {
    if (timer !== null) return;
    timer = window.setTimeout(probe, wait);
    wait = Math.min(wait * 2, 30000);
  }
  window.addEventListener("online", function () {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    wait = 3000;
    probe();
  });
  schedule();
})();
