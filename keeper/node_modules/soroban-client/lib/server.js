"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Server = exports.SUBMIT_TRANSACTION_TIMEOUT = exports.Durability = void 0;
var _urijs = _interopRequireDefault(require("urijs"));
var _stellarBase = require("stellar-base");
var _axios = _interopRequireDefault(require("./axios"));
var jsonrpc = _interopRequireWildcard(require("./jsonrpc"));
var _soroban_rpc = require("./soroban_rpc");
var _transaction = require("./transaction");
var _parsers = require("./parsers");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function _getRequireWildcardCache(e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != _typeof(e) && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _regeneratorRuntime() { "use strict"; _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw new Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator.return && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw new Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, catch: function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw new Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? key : String(key); }
function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
var SUBMIT_TRANSACTION_TIMEOUT = exports.SUBMIT_TRANSACTION_TIMEOUT = 60 * 1000;
var Durability = exports.Durability = function (Durability) {
  Durability["Temporary"] = "temporary";
  Durability["Persistent"] = "persistent";
  return Durability;
}({});
var Server = exports.Server = function () {
  function Server(serverURL) {
    var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    _classCallCheck(this, Server);
    this.serverURL = (0, _urijs.default)(serverURL);
    if (opts.headers && Object.keys(opts.headers).length === 0) {
      _axios.default.interceptors.request.use(function (config) {
        config.headers = Object.assign(config.headers, opts.headers);
        return config;
      });
    }
    if (this.serverURL.protocol() !== 'https' && !opts.allowHttp) {
      throw new Error("Cannot connect to insecure Soroban RPC server if `allowHttp` isn't set");
    }
  }
  _createClass(Server, [{
    key: "getAccount",
    value: (function () {
      var _getAccount = _asyncToGenerator(_regeneratorRuntime().mark(function _callee(address) {
        var ledgerKey, resp, accountEntry;
        return _regeneratorRuntime().wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              ledgerKey = _stellarBase.xdr.LedgerKey.account(new _stellarBase.xdr.LedgerKeyAccount({
                accountId: _stellarBase.Keypair.fromPublicKey(address).xdrPublicKey()
              }));
              _context.next = 3;
              return this.getLedgerEntries(ledgerKey);
            case 3:
              resp = _context.sent;
              if (!(resp.entries.length === 0)) {
                _context.next = 6;
                break;
              }
              return _context.abrupt("return", Promise.reject({
                code: 404,
                message: "Account not found: ".concat(address)
              }));
            case 6:
              accountEntry = resp.entries[0].val.account();
              return _context.abrupt("return", new _stellarBase.Account(address, accountEntry.seqNum().toString()));
            case 8:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function getAccount(_x) {
        return _getAccount.apply(this, arguments);
      }
      return getAccount;
    }())
  }, {
    key: "getHealth",
    value: (function () {
      var _getHealth = _asyncToGenerator(_regeneratorRuntime().mark(function _callee2() {
        return _regeneratorRuntime().wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              return _context2.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'getHealth'));
            case 1:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function getHealth() {
        return _getHealth.apply(this, arguments);
      }
      return getHealth;
    }())
  }, {
    key: "getContractData",
    value: (function () {
      var _getContractData = _asyncToGenerator(_regeneratorRuntime().mark(function _callee3(contract, key) {
        var durability,
          scAddress,
          xdrDurability,
          contractKey,
          _args3 = arguments;
        return _regeneratorRuntime().wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              durability = _args3.length > 2 && _args3[2] !== undefined ? _args3[2] : Durability.Persistent;
              if (!(typeof contract === 'string')) {
                _context3.next = 5;
                break;
              }
              scAddress = new _stellarBase.Contract(contract).address().toScAddress();
              _context3.next = 14;
              break;
            case 5:
              if (!(contract instanceof _stellarBase.Address)) {
                _context3.next = 9;
                break;
              }
              scAddress = contract.toScAddress();
              _context3.next = 14;
              break;
            case 9:
              if (!(contract instanceof _stellarBase.Contract)) {
                _context3.next = 13;
                break;
              }
              scAddress = contract.address().toScAddress();
              _context3.next = 14;
              break;
            case 13:
              throw new TypeError("unknown contract type: ".concat(contract));
            case 14:
              _context3.t0 = durability;
              _context3.next = _context3.t0 === Durability.Temporary ? 17 : _context3.t0 === Durability.Persistent ? 19 : 21;
              break;
            case 17:
              xdrDurability = _stellarBase.xdr.ContractDataDurability.temporary();
              return _context3.abrupt("break", 22);
            case 19:
              xdrDurability = _stellarBase.xdr.ContractDataDurability.persistent();
              return _context3.abrupt("break", 22);
            case 21:
              throw new TypeError("invalid durability: ".concat(durability));
            case 22:
              contractKey = _stellarBase.xdr.LedgerKey.contractData(new _stellarBase.xdr.LedgerKeyContractData({
                key: key,
                contract: scAddress,
                durability: xdrDurability
              }));
              return _context3.abrupt("return", this.getLedgerEntries(contractKey).then(function (r) {
                if (r.entries.length === 0) {
                  return Promise.reject({
                    code: 404,
                    message: "Contract data not found. Contract: ".concat(_stellarBase.Address.fromScAddress(scAddress).toString(), ", Key: ").concat(key.toXDR('base64'), ", Durability: ").concat(durability)
                  });
                }
                return r.entries[0];
              }));
            case 24:
            case "end":
              return _context3.stop();
          }
        }, _callee3, this);
      }));
      function getContractData(_x2, _x3) {
        return _getContractData.apply(this, arguments);
      }
      return getContractData;
    }())
  }, {
    key: "getLedgerEntries",
    value: (function () {
      var _getLedgerEntries2 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee4() {
        var _args4 = arguments;
        return _regeneratorRuntime().wrap(function _callee4$(_context4) {
          while (1) switch (_context4.prev = _context4.next) {
            case 0:
              return _context4.abrupt("return", this._getLedgerEntries.apply(this, _args4).then(_parsers.parseRawLedgerEntries));
            case 1:
            case "end":
              return _context4.stop();
          }
        }, _callee4, this);
      }));
      function getLedgerEntries() {
        return _getLedgerEntries2.apply(this, arguments);
      }
      return getLedgerEntries;
    }())
  }, {
    key: "_getLedgerEntries",
    value: function () {
      var _getLedgerEntries3 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee5() {
        var _len,
          keys,
          _key,
          _args5 = arguments;
        return _regeneratorRuntime().wrap(function _callee5$(_context5) {
          while (1) switch (_context5.prev = _context5.next) {
            case 0:
              for (_len = _args5.length, keys = new Array(_len), _key = 0; _key < _len; _key++) {
                keys[_key] = _args5[_key];
              }
              return _context5.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'getLedgerEntries', keys.map(function (k) {
                return k.toXDR('base64');
              })));
            case 2:
            case "end":
              return _context5.stop();
          }
        }, _callee5, this);
      }));
      function _getLedgerEntries() {
        return _getLedgerEntries3.apply(this, arguments);
      }
      return _getLedgerEntries;
    }()
  }, {
    key: "getTransaction",
    value: (function () {
      var _getTransaction2 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee6(hash) {
        return _regeneratorRuntime().wrap(function _callee6$(_context6) {
          while (1) switch (_context6.prev = _context6.next) {
            case 0:
              return _context6.abrupt("return", this._getTransaction(hash).then(function (raw) {
                var successInfo = {};
                if (raw.status === _soroban_rpc.SorobanRpc.GetTransactionStatus.SUCCESS) {
                  var _meta$v3$sorobanMeta;
                  var meta = _stellarBase.xdr.TransactionMeta.fromXDR(raw.resultMetaXdr, 'base64');
                  successInfo = _objectSpread({
                    ledger: raw.ledger,
                    createdAt: raw.createdAt,
                    applicationOrder: raw.applicationOrder,
                    feeBump: raw.feeBump,
                    envelopeXdr: _stellarBase.xdr.TransactionEnvelope.fromXDR(raw.envelopeXdr, 'base64'),
                    resultXdr: _stellarBase.xdr.TransactionResult.fromXDR(raw.resultXdr, 'base64'),
                    resultMetaXdr: meta
                  }, meta.switch() === 3 && meta.v3().sorobanMeta() !== null && {
                    returnValue: (_meta$v3$sorobanMeta = meta.v3().sorobanMeta()) === null || _meta$v3$sorobanMeta === void 0 ? void 0 : _meta$v3$sorobanMeta.returnValue()
                  });
                }
                var result = _objectSpread({
                  status: raw.status,
                  latestLedger: raw.latestLedger,
                  latestLedgerCloseTime: raw.latestLedgerCloseTime,
                  oldestLedger: raw.oldestLedger,
                  oldestLedgerCloseTime: raw.oldestLedgerCloseTime
                }, successInfo);
                return result;
              }));
            case 1:
            case "end":
              return _context6.stop();
          }
        }, _callee6, this);
      }));
      function getTransaction(_x4) {
        return _getTransaction2.apply(this, arguments);
      }
      return getTransaction;
    }())
  }, {
    key: "_getTransaction",
    value: function () {
      var _getTransaction3 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee7(hash) {
        return _regeneratorRuntime().wrap(function _callee7$(_context7) {
          while (1) switch (_context7.prev = _context7.next) {
            case 0:
              return _context7.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'getTransaction', hash));
            case 1:
            case "end":
              return _context7.stop();
          }
        }, _callee7, this);
      }));
      function _getTransaction(_x5) {
        return _getTransaction3.apply(this, arguments);
      }
      return _getTransaction;
    }()
  }, {
    key: "getEvents",
    value: (function () {
      var _getEvents2 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee8(request) {
        return _regeneratorRuntime().wrap(function _callee8$(_context8) {
          while (1) switch (_context8.prev = _context8.next) {
            case 0:
              return _context8.abrupt("return", this._getEvents(request).then(_parsers.parseRawEvents));
            case 1:
            case "end":
              return _context8.stop();
          }
        }, _callee8, this);
      }));
      function getEvents(_x6) {
        return _getEvents2.apply(this, arguments);
      }
      return getEvents;
    }())
  }, {
    key: "_getEvents",
    value: function () {
      var _getEvents3 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee9(request) {
        var _request$filters;
        return _regeneratorRuntime().wrap(function _callee9$(_context9) {
          while (1) switch (_context9.prev = _context9.next) {
            case 0:
              return _context9.abrupt("return", jsonrpc.postObject(this.serverURL.toString(), 'getEvents', _objectSpread({
                filters: (_request$filters = request.filters) !== null && _request$filters !== void 0 ? _request$filters : [],
                pagination: _objectSpread(_objectSpread({}, request.cursor && {
                  cursor: request.cursor
                }), request.limit && {
                  limit: request.limit
                })
              }, request.startLedger && {
                startLedger: request.startLedger
              })));
            case 1:
            case "end":
              return _context9.stop();
          }
        }, _callee9, this);
      }));
      function _getEvents(_x7) {
        return _getEvents3.apply(this, arguments);
      }
      return _getEvents;
    }()
  }, {
    key: "getNetwork",
    value: (function () {
      var _getNetwork = _asyncToGenerator(_regeneratorRuntime().mark(function _callee10() {
        return _regeneratorRuntime().wrap(function _callee10$(_context10) {
          while (1) switch (_context10.prev = _context10.next) {
            case 0:
              _context10.next = 2;
              return jsonrpc.post(this.serverURL.toString(), 'getNetwork');
            case 2:
              return _context10.abrupt("return", _context10.sent);
            case 3:
            case "end":
              return _context10.stop();
          }
        }, _callee10, this);
      }));
      function getNetwork() {
        return _getNetwork.apply(this, arguments);
      }
      return getNetwork;
    }())
  }, {
    key: "getLatestLedger",
    value: (function () {
      var _getLatestLedger = _asyncToGenerator(_regeneratorRuntime().mark(function _callee11() {
        return _regeneratorRuntime().wrap(function _callee11$(_context11) {
          while (1) switch (_context11.prev = _context11.next) {
            case 0:
              return _context11.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'getLatestLedger'));
            case 1:
            case "end":
              return _context11.stop();
          }
        }, _callee11, this);
      }));
      function getLatestLedger() {
        return _getLatestLedger.apply(this, arguments);
      }
      return getLatestLedger;
    }())
  }, {
    key: "simulateTransaction",
    value: (function () {
      var _simulateTransaction2 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee12(transaction) {
        return _regeneratorRuntime().wrap(function _callee12$(_context12) {
          while (1) switch (_context12.prev = _context12.next) {
            case 0:
              return _context12.abrupt("return", this._simulateTransaction(transaction).then(_parsers.parseRawSimulation));
            case 1:
            case "end":
              return _context12.stop();
          }
        }, _callee12, this);
      }));
      function simulateTransaction(_x8) {
        return _simulateTransaction2.apply(this, arguments);
      }
      return simulateTransaction;
    }())
  }, {
    key: "_simulateTransaction",
    value: function () {
      var _simulateTransaction3 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee13(transaction) {
        return _regeneratorRuntime().wrap(function _callee13$(_context13) {
          while (1) switch (_context13.prev = _context13.next) {
            case 0:
              return _context13.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'simulateTransaction', transaction.toXDR()));
            case 1:
            case "end":
              return _context13.stop();
          }
        }, _callee13, this);
      }));
      function _simulateTransaction(_x9) {
        return _simulateTransaction3.apply(this, arguments);
      }
      return _simulateTransaction;
    }()
  }, {
    key: "prepareTransaction",
    value: (function () {
      var _prepareTransaction = _asyncToGenerator(_regeneratorRuntime().mark(function _callee14(transaction, networkPassphrase) {
        var _yield$Promise$all, _yield$Promise$all2, passphrase, simResponse;
        return _regeneratorRuntime().wrap(function _callee14$(_context14) {
          while (1) switch (_context14.prev = _context14.next) {
            case 0:
              _context14.next = 2;
              return Promise.all([networkPassphrase ? Promise.resolve({
                passphrase: networkPassphrase
              }) : this.getNetwork(), this.simulateTransaction(transaction)]);
            case 2:
              _yield$Promise$all = _context14.sent;
              _yield$Promise$all2 = _slicedToArray(_yield$Promise$all, 2);
              passphrase = _yield$Promise$all2[0].passphrase;
              simResponse = _yield$Promise$all2[1];
              if (!_soroban_rpc.SorobanRpc.isSimulationError(simResponse)) {
                _context14.next = 8;
                break;
              }
              throw simResponse.error;
            case 8:
              if (simResponse.result) {
                _context14.next = 10;
                break;
              }
              throw new Error('transaction simulation failed');
            case 10:
              return _context14.abrupt("return", (0, _transaction.assembleTransaction)(transaction, passphrase, simResponse).build());
            case 11:
            case "end":
              return _context14.stop();
          }
        }, _callee14, this);
      }));
      function prepareTransaction(_x10, _x11) {
        return _prepareTransaction.apply(this, arguments);
      }
      return prepareTransaction;
    }())
  }, {
    key: "sendTransaction",
    value: (function () {
      var _sendTransaction2 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee15(transaction) {
        return _regeneratorRuntime().wrap(function _callee15$(_context15) {
          while (1) switch (_context15.prev = _context15.next) {
            case 0:
              return _context15.abrupt("return", this._sendTransaction(transaction).then(_parsers.parseRawSendTransaction));
            case 1:
            case "end":
              return _context15.stop();
          }
        }, _callee15, this);
      }));
      function sendTransaction(_x12) {
        return _sendTransaction2.apply(this, arguments);
      }
      return sendTransaction;
    }())
  }, {
    key: "_sendTransaction",
    value: function () {
      var _sendTransaction3 = _asyncToGenerator(_regeneratorRuntime().mark(function _callee16(transaction) {
        return _regeneratorRuntime().wrap(function _callee16$(_context16) {
          while (1) switch (_context16.prev = _context16.next) {
            case 0:
              return _context16.abrupt("return", jsonrpc.post(this.serverURL.toString(), 'sendTransaction', transaction.toXDR()));
            case 1:
            case "end":
              return _context16.stop();
          }
        }, _callee16, this);
      }));
      function _sendTransaction(_x13) {
        return _sendTransaction3.apply(this, arguments);
      }
      return _sendTransaction;
    }()
  }, {
    key: "requestAirdrop",
    value: (function () {
      var _requestAirdrop = _asyncToGenerator(_regeneratorRuntime().mark(function _callee17(address, friendbotUrl) {
        var account, response, meta, sequence, _error$response, _error$response$detai;
        return _regeneratorRuntime().wrap(function _callee17$(_context17) {
          while (1) switch (_context17.prev = _context17.next) {
            case 0:
              account = typeof address === 'string' ? address : address.accountId();
              _context17.t0 = friendbotUrl;
              if (_context17.t0) {
                _context17.next = 6;
                break;
              }
              _context17.next = 5;
              return this.getNetwork();
            case 5:
              _context17.t0 = _context17.sent.friendbotUrl;
            case 6:
              friendbotUrl = _context17.t0;
              if (friendbotUrl) {
                _context17.next = 9;
                break;
              }
              throw new Error('No friendbot URL configured for current network');
            case 9:
              _context17.prev = 9;
              _context17.next = 12;
              return _axios.default.post("".concat(friendbotUrl, "?addr=").concat(encodeURIComponent(account)));
            case 12:
              response = _context17.sent;
              meta = _stellarBase.xdr.TransactionMeta.fromXDR(response.data.result_meta_xdr, 'base64');
              sequence = findCreatedAccountSequenceInTransactionMeta(meta);
              return _context17.abrupt("return", new _stellarBase.Account(account, sequence));
            case 18:
              _context17.prev = 18;
              _context17.t1 = _context17["catch"](9);
              if (!(((_error$response = _context17.t1.response) === null || _error$response === void 0 ? void 0 : _error$response.status) === 400)) {
                _context17.next = 23;
                break;
              }
              if (!((_error$response$detai = _context17.t1.response.detail) !== null && _error$response$detai !== void 0 && _error$response$detai.includes('createAccountAlreadyExist'))) {
                _context17.next = 23;
                break;
              }
              return _context17.abrupt("return", this.getAccount(account));
            case 23:
              throw _context17.t1;
            case 24:
            case "end":
              return _context17.stop();
          }
        }, _callee17, this, [[9, 18]]);
      }));
      function requestAirdrop(_x14, _x15) {
        return _requestAirdrop.apply(this, arguments);
      }
      return requestAirdrop;
    }())
  }]);
  return Server;
}();
function findCreatedAccountSequenceInTransactionMeta(meta) {
  var operations = [];
  switch (meta.switch()) {
    case 0:
      operations = meta.operations();
      break;
    case 1:
    case 2:
    case 3:
      operations = meta.value().operations();
      break;
    default:
      throw new Error('Unexpected transaction meta switch value');
  }
  var _iterator = _createForOfIteratorHelper(operations),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var op = _step.value;
      var _iterator2 = _createForOfIteratorHelper(op.changes()),
        _step2;
      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var c = _step2.value;
          if (c.switch() !== _stellarBase.xdr.LedgerEntryChangeType.ledgerEntryCreated()) {
            continue;
          }
          var data = c.created().data();
          if (data.switch() !== _stellarBase.xdr.LedgerEntryType.account()) {
            continue;
          }
          return data.account().seqNum().toString();
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  throw new Error('No account created in transaction');
}