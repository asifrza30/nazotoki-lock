(function () {
  "use strict";

  var SALT = "rt-lock-9f2c41";
  var PASS_KEY = "rt-lock-pass";
  var CLEAR_URL = "clear.html";

  // Swap to a URL to move checking server-side; the front end does not change.
  var ENDPOINT = null;

  var HASHES = [
    "97dbd67494e7e6f247c47b32f6316f09811a8fc4511ce798a2ca946715725662",
    "41c2be7a27f667ef89164e6dd8c0a33c8a3e5b4cd08b146ac5f811b75e89999d",
    "6e5f7a10821f009c2b99b469055690e47012071157cfc2ae1be21d30718d27c1",
    "18bce801bef382df27f26654da6f98f8f24132d7a8e985823a87e3f7ba5c01df",
    "dc0699d606c0c7f5b3fe5dc16f6470fdd27ca3b1e9c1711965461ac8546708dd",
    "443182f6ad93495d3646b464c8e0b712a7487286ccc6cbab6b2464e0093aa1ef",
    "46ba3dbeb6cc325697a214e1a8b775bc168fec8bab59106a483614965606651a",
    "ad28d6a7b342102ad15ffc1e91d7491292aa6c0fe713e78e330201aa622df8a8",
    "919b1e058cba244382f9273a0c17165d2edc4de078856c9e631937d544645ef4",
    "286b0ebb644fd4b0c469f1465441a7fa6b2f5a9510ccfffaf1afdfc0915d1408"
  ];

  var LONG_VOWEL = /[-‐‑–—―－ｰ一ー]/g;
  var SPACE = /[\s　​-‍﻿]/g;

  // Whitespace and prolonged-mark lookalikes are keyboard noise and get folded.
  // Katakana is not: the client requires hiragana, so クイーン stays wrong.
  function normalize(value) {
    var s = String(value == null ? "" : value).replace(SPACE, "");
    if (s.normalize) s = s.normalize("NFKC");
    return s.replace(SPACE, "").replace(LONG_VOWEL, "ー");
  }

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map
        .call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, "0");
        })
        .join("");
    });
  }

  function checkLocally(values) {
    return Promise.all(values.map(function (v) { return sha256(SALT + v); })).then(function (hashes) {
      return hashes.every(function (h, i) { return h === HASHES[i]; });
    });
  }

  function checkRemotely(values) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ answers: values })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data && data.token) store(data.token);
        return !!(data && data.correct);
      });
  }

  function check(values) {
    return ENDPOINT ? checkRemotely(values) : checkLocally(values);
  }

  function store(token) {
    try {
      sessionStorage.setItem(PASS_KEY, token);
    } catch (e) {}
  }

  function grantToken(values) {
    return sha256(SALT + "|" + values.join("")).then(store);
  }

  window.LOCK = { normalize: normalize, check: check, PASS_KEY: PASS_KEY, SALT: SALT };

  // Reveal on scroll into view, the same trigger the rest of the site uses via
  // jquery-inview. Without JS the .lock-motion class is never set, so nothing hides.
  var root = document.querySelector(".lock");
  var reveals = document.querySelectorAll(".lock-reveal");
  if (root && reveals.length && "IntersectionObserver" in window) {
    root.classList.add("lock-motion");
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        seen.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(reveals, function (el) {
      seen.observe(el);
    });
  }

  var form = document.getElementById("lock-form");
  if (!form) return;

  var inputs = Array.prototype.slice.call(form.querySelectorAll(".lock-input"));
  var submit = form.querySelector(".lock-submit");
  var modal = document.getElementById("lock-modal");
  var lastFocused = null;
  var busy = false;

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    modal.querySelector(".lock-modal-close").focus();
    document.addEventListener("keydown", onModalKey, true);
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    document.removeEventListener("keydown", onModalKey, true);
    (lastFocused && lastFocused.focus ? lastFocused : inputs[0]).focus();
  }

  function onModalKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;
    var focusable = modal.querySelectorAll("button");
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  modal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) closeModal();
  });

  inputs.forEach(function (input, i) {
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      if (i < inputs.length - 1) {
        e.preventDefault();
        inputs[i + 1].focus();
      }
    });
    input.addEventListener("input", function () {
      input.classList.remove("is-flagged");
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;

    // Commit any open IME composition before reading the fields.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    busy = true;
    submit.disabled = true;

    var values = inputs.map(function (input) { return normalize(input.value); });

    check(values)
      .then(function (ok) {
        if (!ok) {
          inputs.forEach(function (input) { input.classList.add("is-flagged"); });
          openModal();
          return;
        }
        return grantToken(values).then(function () {
          window.location.href = CLEAR_URL;
        });
      })
      .catch(function (err) {
        console.error("[lock] validation failed", err);
        openModal();
      })
      .then(function () {
        busy = false;
        submit.disabled = false;
      });
  });
})();
