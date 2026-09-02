(function pulseInstrumentation() {
  'use strict';

  var script = document.currentScript;
  var mode = (script && script.dataset.pulseMode) || 'public';
  var site = (script && script.dataset.pulseSite) || location.hostname;
  var trackerScript = document.querySelector('script[data-website-id][src*="/script.js"]');
  var websiteId =
    (trackerScript && trackerScript.dataset.websiteId) ||
    (script && script.dataset.pulseWebsiteId) || '';
  var pending = [];
  var pendingIdentify = [];
  var pageState;
  var flushTimer;
  var downloadPattern = /\.(?:7z|avi|csv|docx?|dmg|epub|exe|gz|ics|iso|jpeg|jpg|m4a|mov|mp3|mp4|msi|pdf|pkg|png|pptx?|rar|rtf|svg|tar|tgz|txt|wav|webm|webp|xlsx?|xml|zip)$/i;
  var idPattern = /^(?:\d{4,}|[a-f\d]{8,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;

  function loadPostHog() {
    if (window.posthog || document.querySelector('script[data-pulse-posthog]')) return;

    var origin = 'https://pulse.szakacsmedia.com';
    try {
      if (script && script.src) origin = new URL(script.src).origin;
    } catch (_) {
      // Use the canonical Pulse origin.
    }

    var posthogScript = document.createElement('script');
    posthogScript.async = true;
    posthogScript.src = origin + '/posthog.js';
    posthogScript.dataset.pulsePosthog = 'true';
    posthogScript.dataset.posthogSite = site;
    posthogScript.dataset.posthogMode = mode;
    if (websiteId) posthogScript.dataset.posthogWebsiteId = websiteId;
    if (script && script.nonce) posthogScript.nonce = script.nonce;
    (document.head || document.documentElement).appendChild(posthogScript);
  }

  loadPostHog();

  function cleanValue(value, limit) {
    if (!value) return undefined;
    return String(value)
      .replace(/[^a-zA-Z0-9._~:/+ -]/g, '')
      .trim()
      .slice(0, limit || 120) || undefined;
  }

  function safePath(value) {
    try {
      var url = new URL(value || location.href, location.href);
      var path = url.pathname
        .split('/')
        .map(function (part) { return idPattern.test(part) ? ':id' : part; })
        .join('/');
      return cleanValue(path || '/', 160) || '/';
    } catch (_) {
      return '/';
    }
  }

  function placement(element) {
    if (!element || !element.closest) return 'unknown';
    if (element.closest('header')) return 'header';
    if (element.closest('nav')) return 'navigation';
    if (element.closest('footer')) return 'footer';
    if (element.closest('form')) return 'form';
    if (element.closest('aside')) return 'aside';
    return 'content';
  }

  function viewportClass() {
    if (window.innerWidth < 640) return 'mobile';
    if (window.innerWidth < 1024) return 'tablet';
    return 'desktop';
  }

  function enrich(properties) {
    var output = {
      page_path: safePath(location.href),
      site: cleanValue(site, 80),
    };
    Object.keys(properties || {}).forEach(function (key) {
      var value = properties[key];
      if (value !== undefined && value !== null && value !== '') output[key] = value;
    });
    return output;
  }

  function flush() {
    if (!window.umami || typeof window.umami.track !== 'function') return;
    while (pendingIdentify.length) {
      try { window.umami.identify(pendingIdentify.shift()); } catch (_) { break; }
    }
    while (pending.length) {
      var item = pending.shift();
      try { window.umami.track(item.name, item.properties); } catch (_) { break; }
    }
    if (!pending.length && !pendingIdentify.length && flushTimer) {
      clearInterval(flushTimer);
      flushTimer = undefined;
    }
  }

  function ensureFlush() {
    flush();
    if (!flushTimer && (pending.length || pendingIdentify.length)) {
      flushTimer = setInterval(flush, 250);
      setTimeout(function () {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = undefined;
        pending.length = 0;
        pendingIdentify.length = 0;
      }, 15000);
    }
  }

  function track(name, properties) {
    pending.push({ name: name, properties: enrich(properties) });
    ensureFlush();
  }

  function identify(properties) {
    pendingIdentify.push(properties);
    ensureFlush();
  }

  function campaignData() {
    var params = new URLSearchParams(location.search);
    var data = {};
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (key) {
      var value = cleanValue(params.get('utm_' + key), 100);
      if (value) data['first_utm_' + key] = value;
    });
    if (params.has('gclid')) data.google_ads_click = true;
    if (params.has('fbclid')) data.meta_ads_click = true;
    if (params.has('msclkid')) data.microsoft_ads_click = true;
    return data;
  }

  function initializeAttribution() {
    var key = 'pulse:first-touch:v1';
    var first;
    try { first = JSON.parse(sessionStorage.getItem(key)); } catch (_) {}
    if (!first) {
      var referrerHost;
      try { referrerHost = document.referrer ? new URL(document.referrer).hostname : 'direct'; } catch (_) { referrerHost = 'unknown'; }
      first = Object.assign({
        first_landing_path: safePath(location.href),
        first_referrer_host: cleanValue(referrerHost, 100),
      }, campaignData());
      try { sessionStorage.setItem(key, JSON.stringify(first)); } catch (_) {}
    }
    identify(first);
    var campaign = campaignData();
    if (Object.keys(campaign).length) track('campaign_landing', campaign);
  }

  function scrollPercent() {
    var root = document.documentElement;
    var available = Math.max(0, root.scrollHeight - window.innerHeight);
    if (!available) return 100;
    return Math.min(100, Math.max(0, Math.round((window.scrollY / available) * 100)));
  }

  function finishPage(reason) {
    if (!pageState || pageState.finished) return;
    pageState.finished = true;
    if (pageState.activeSeconds >= 1) {
      track('page_engagement_summary', {
        page_path: pageState.path,
        active_seconds: Math.round(pageState.activeSeconds),
        max_scroll_percent: pageState.maxScroll,
        completion_reason: reason,
        viewport: viewportClass(),
      });
    }
  }

  function beginPage(reason) {
    finishPage(reason || 'navigation');
    pageState = {
      activeSeconds: 0,
      finished: false,
      lastTick: Date.now(),
      maxScroll: scrollPercent(),
      scrollMilestones: {},
      timeMilestones: {},
      path: safePath(location.href),
    };
    track('page_view_enriched', {
      navigation_type: reason || 'initial',
      viewport: viewportClass(),
      referrer_host: (function () {
        try { return document.referrer ? cleanValue(new URL(document.referrer).hostname, 100) : 'direct'; } catch (_) { return 'unknown'; }
      })(),
    });
  }

  function tick() {
    if (!pageState || pageState.finished) return;
    var now = Date.now();
    var elapsed = Math.min(2, Math.max(0, (now - pageState.lastTick) / 1000));
    pageState.lastTick = now;
    if (document.visibilityState === 'visible' && document.hasFocus()) pageState.activeSeconds += elapsed;
    [10, 30, 60, 120, 300].forEach(function (seconds) {
      if (pageState.activeSeconds >= seconds && !pageState.timeMilestones[seconds]) {
        pageState.timeMilestones[seconds] = true;
        track('engaged_time', { seconds: seconds, viewport: viewportClass() });
      }
    });
  }

  function onScroll() {
    if (!pageState || pageState.finished) return;
    var percent = scrollPercent();
    pageState.maxScroll = Math.max(pageState.maxScroll, percent);
    [25, 50, 75, 90, 100].forEach(function (milestone) {
      if (percent >= milestone && !pageState.scrollMilestones[milestone]) {
        pageState.scrollMilestones[milestone] = true;
        track('scroll_depth', { percent: milestone, viewport: viewportClass() });
      }
    });
  }

  function linkProperties(anchor) {
    var url;
    try { url = new URL(anchor.href, location.href); } catch (_) { return {}; }
    return {
      destination_host: cleanValue(url.hostname, 100),
      destination_path: safePath(url.href),
      placement: placement(anchor),
    };
  }

  function onClick(event) {
    if (mode !== 'public') return;
    var target = event.target && event.target.closest ? event.target.closest('a,button,[role="button"]') : null;
    if (!target || target.hasAttribute('data-pulse-ignore')) return;

    if (target.matches('a[href]')) {
      var href = target.getAttribute('href') || '';
      var props = linkProperties(target);
      if (/^mailto:/i.test(href)) return track('contact_email_click', { placement: props.placement });
      if (/^tel:/i.test(href)) return track('contact_phone_click', { placement: props.placement });
      if (downloadPattern.test(href.split(/[?#]/)[0]) || target.hasAttribute('download')) return track('download_click', props);
      try {
        var url = new URL(target.href, location.href);
        if (url.origin !== location.origin) return track('outbound_link_click', props);
      } catch (_) { return; }
      return track('internal_link_click', props);
    }

    track('button_click', {
      button_type: cleanValue(target.getAttribute('type') || target.getAttribute('role') || 'button', 30),
      placement: placement(target),
      control: cleanValue(target.getAttribute('data-analytics-name'), 60) || 'unlabeled',
    });
  }

  function formKey(form) {
    var forms = Array.prototype.slice.call(document.forms || []);
    return cleanValue(form.getAttribute('data-analytics-name'), 60) || 'form_' + (forms.indexOf(form) + 1);
  }

  function onFormStart(event) {
    if (mode !== 'public') return;
    var form = event.target && event.target.closest ? event.target.closest('form') : null;
    if (!form || form.dataset.pulseStarted) return;
    form.dataset.pulseStarted = 'true';
    track('form_start', { form: formKey(form), placement: placement(form) });
  }

  function onFormSubmit(event) {
    if (mode !== 'public') return;
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    track('form_submit_attempt', { form: formKey(form), placement: placement(form) });
  }

  function onError() {
    if (mode !== 'public') return;
    track('client_error', { error_type: 'script_error' });
  }

  function onRejection() {
    if (mode !== 'public') return;
    track('client_error', { error_type: 'unhandled_rejection' });
  }

  function instrumentNavigation() {
    ['pushState', 'replaceState'].forEach(function (method) {
      var original = history[method];
      if (!original || original.__pulseWrapped) return;
      function wrapped() {
        var result = original.apply(this, arguments);
        window.dispatchEvent(new Event('pulse:navigation'));
        return result;
      }
      wrapped.__pulseWrapped = true;
      history[method] = wrapped;
    });
    window.addEventListener('popstate', function () { window.dispatchEvent(new Event('pulse:navigation')); });
    window.addEventListener('pulse:navigation', function () {
      if (!pageState || pageState.path !== safePath(location.href)) beginPage('spa_navigation');
    });
  }

  initializeAttribution();
  beginPage('initial');
  instrumentNavigation();
  setInterval(tick, 1000);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFormStart, true);
  document.addEventListener('submit', onFormSubmit, true);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', function () { finishPage('pagehide'); });
  document.addEventListener('visibilitychange', function () {
    if (pageState) pageState.lastTick = Date.now();
  });
  onScroll();
})();
