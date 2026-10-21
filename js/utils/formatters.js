// SalesStock Pro - Formatters Utility
// Provides consistent formatting for currency, dates, and numbers

(function (global) {
  'use strict';

  // Constants (frozen to prevent modification)
  const CONSTANTS = Object.freeze({
    ITBIS_RATE: 0.18,
    PAGE_W: 80,
    MARGIN_X: 8,
    FONT: 'helvetica',
    LINE_COLOR: [180, 180, 180]
  });

  // Derived constants
  const INNER_W = CONSTANTS.PAGE_W - CONSTANTS.MARGIN_X * 2;

  // Safe number conversion
  function toNumber(value) {
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }

  // Currency formatting (Dominican Peso)
  function fmtMoney(value) {
    return 'RD$' + toNumber(value).toFixed(2);
  }

  // Invoice currency formatting (with space)
  function fmtMoneyInvoice(value) {
    return 'RD$ ' + toNumber(value).toFixed(2);
  }

  // Round to 2 decimal places
  function round2(value) {
    return Math.round(toNumber(value) * 100) / 100;
  }

  // Round to whole number (peso)
  function roundPeso(value) {
    return Math.round(toNumber(value));
  }

  // Date formatting (Spanish locale)
  function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return d.toISOString().split('T')[0];
    }
  }

  // Short date (no time)
  function fmtDateShort(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (e) {
      return d.toISOString().split('T')[0];
    }
  }

  // Format quantity (no decimals for whole numbers)
  function fmtQty(value) {
    const n = toNumber(value);
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  // Public API
  const Utils = Object.freeze({
    // Constants
    ITBIS_RATE: CONSTANTS.ITBIS_RATE,
    PAGE_W: CONSTANTS.PAGE_W,
    MARGIN_X: CONSTANTS.MARGIN_X,
    INNER_W: INNER_W,
    FONT: CONSTANTS.FONT,
    LINE_COLOR: CONSTANTS.LINE_COLOR,

    // Formatters
    fmtMoney,
    fmtMoneyInvoice,
    round2,
    roundPeso,
    fmtDate,
    fmtDateShort,
    fmtQty
  });

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return Utils; });
  } else {
    global.App = global.App || {};
    global.App.Utils = Utils;
  }

})(typeof window !== 'undefined' ? window : this);