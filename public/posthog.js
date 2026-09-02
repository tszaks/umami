(function pulsePostHog() {
  'use strict';

  var loader = document.currentScript;
  var mode = (loader && loader.dataset.posthogMode) || 'public';
  var site = (loader && loader.dataset.posthogSite) || location.hostname;
  var domain = location.hostname.toLowerCase();
  var websiteId = (loader && loader.dataset.posthogWebsiteId) || '';
  var websiteIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!websiteIdPattern.test(websiteId)) websiteId = '';
  var projectToken = 'phc_sP3NWLrzhFvhWnzdgtJZi2gmAhUnHQp5LNthvXWyGBZ8';
  var scriptOrigin = 'https://pulse.szakacsmedia.com';
  var privateMode = mode !== 'public';
  var idPattern = /^(?:\d{4,}|[a-f\d]{8,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;
  var allowedCampaignParameters = /^(?:utm_(?:source|medium|campaign|content|term)|gclid|fbclid|msclkid|li_fat_id|ttclid|twclid)$/i;
  try {
    if (loader && loader.src) scriptOrigin = new URL(loader.src).origin;
  } catch (_) {
    // Use the canonical Pulse origin.
  }
  var apiHost = scriptOrigin + '/ph';
  var urlProperties = [
    '$current_url',
    '$initial_current_url',
    '$session_entry_url',
    '$referrer',
    '$external_click_url',
  ];

  function sanitizeUrl(value) {
    if (!value || typeof value !== 'string') return value;

    try {
      var url = new URL(value, location.href);
      var pathParts = url.pathname.split('/');
      url.pathname = pathParts
        .map(function (part) {
          return idPattern.test(part) ? ':id' : part;
        })
        .join('/');
      if (privateMode) {
        var privateParts = url.pathname.split('/').filter(Boolean);
        url.pathname = privateParts.length ? '/' + privateParts[0] + (privateParts.length > 1 ? '/:private' : '') : '/';
      }
      var safeParameters = new URLSearchParams();
      url.searchParams.forEach(function (parameterValue, parameterName) {
        if (allowedCampaignParameters.test(parameterName)) {
          safeParameters.set(parameterName, parameterValue.slice(0, 200));
        }
      });
      url.search = safeParameters.toString();
      url.hash = '';
      return url.toString();
    } catch (_) {
      return value.split(/[?#]/)[0];
    }
  }

  function sanitizeEvent(event) {
    if (!event || !event.properties) return event;

    urlProperties.forEach(function (propertyName) {
      if (event.properties[propertyName]) {
        event.properties[propertyName] = sanitizeUrl(event.properties[propertyName]);
      }
    });

    if (Array.isArray(event.properties.$elements)) {
      event.properties.$elements.forEach(function (element) {
        if (!element || typeof element !== 'object') return;
        if (element.attr__href) element.attr__href = sanitizeUrl(element.attr__href);
        delete element.attr__value;
        if (privateMode) {
          Object.keys(element).forEach(function (key) {
            if (key.indexOf('attr__') === 0) delete element[key];
          });
          delete element.text;
        }
      });
    }

    if (privateMode) {
      delete event.properties.$title;
      delete event.properties.$el_text;
      delete event.properties.$elements_chain;
    }

    event.properties.site = site;
    event.properties.pulse_domain = domain;
    event.properties.pulse_mode = mode;
    if (websiteId) event.properties.pulse_website_id = websiteId;
    return event;
  }

  !(function loadPostHog(documentObject, posthog) {
    var methods;
    var scriptElement;
    var firstScript;

    if (posthog.__SV || (window.posthog && window.posthog.__loaded)) return;

    window.posthog = posthog;
    posthog._i = [];
    posthog.init = function init(token, config, name) {
      function stub(target, method) {
        var parts = method.split('.');
        if (parts.length === 2) {
          target = target[parts[0]];
          method = parts[1];
        }
        target[method] = function queuedMethod() {
          target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }

      if (!scriptElement) {
        scriptElement = documentObject.createElement('script');
        scriptElement.type = 'text/javascript';
        scriptElement.crossOrigin = 'anonymous';
        scriptElement.async = true;
        scriptElement.src =
          config.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') +
          '/static/array.js';
        scriptElement.onerror = function removeFailedLoader() {
          scriptElement = null;
        };
        firstScript = documentObject.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(scriptElement, firstScript);
      }

      var instance = posthog;
      if (name !== undefined) instance = posthog[name] = [];
      else name = 'posthog';
      instance.people = instance.people || [];
      instance.toString = function toString(detail) {
        var label = 'posthog';
        if (name !== 'posthog') label += '.' + name;
        if (!detail) label += ' (stub)';
        return label;
      };
      instance.people.toString = function peopleToString() {
        return instance.toString(1) + '.people (stub)';
      };
      methods =
        'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(
          ' ',
        );
      for (var index = 0; index < methods.length; index += 1) stub(instance, methods[index]);
      posthog._i.push([token, config, name]);
    };
    posthog.__SV = 1;
  })(document, window.posthog || []);

  window.posthog.init(projectToken, {
    api_host: apiHost,
    asset_host: apiHost,
    ui_host: 'https://us.posthog.com',
    defaults: '2026-05-30',
    strict_script_versioning: true,
    autocapture: privateMode
      ? {
          dom_event_allowlist: ['click'],
          element_allowlist: ['a', 'button'],
          css_selector_ignorelist: ['.ph-no-capture', '[data-ph-no-autocapture]', '[data-private]', '[data-sensitive]', '[data-pulse-private]'],
          capture_copied_text: false,
        }
      : { capture_copied_text: false },
    rageclick: true,
    capture_dead_clicks: true,
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_performance: privateMode ? { network_timing: false, web_vitals: true } : true,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    capture_heatmaps: true,
    enable_recording_console_log: !privateMode,
    person_profiles: 'identified_only',
    disable_capture_url_hashes: true,
    mask_all_text: privateMode,
    mask_all_element_attributes: privateMode,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: privateMode ? 'body' : '[data-private],[data-sensitive],[data-pulse-private]',
      maskAllElementAttributes: privateMode,
      blockSelector: privateMode
        ? 'form,input,textarea,select,option,[contenteditable],canvas,video,audio,iframe,img,[data-private],[data-sensitive],[data-pulse-private]'
        : 'input[type="password"],[autocomplete*="cc-"],[data-private],[data-sensitive],[data-pulse-private],img[src^="blob:"],img[src^="data:"]',
    },
    before_send: sanitizeEvent,
  });
  var sharedProperties = { site: site, pulse_domain: domain, pulse_mode: mode };
  if (websiteId) sharedProperties.pulse_website_id = websiteId;
  window.posthog.register(sharedProperties);
})();
