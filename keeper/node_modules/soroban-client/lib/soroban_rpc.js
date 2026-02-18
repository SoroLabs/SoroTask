"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SorobanRpc = void 0;
var SorobanRpc;
(function (_SorobanRpc) {
  var GetTransactionStatus = function (GetTransactionStatus) {
    GetTransactionStatus["SUCCESS"] = "SUCCESS";
    GetTransactionStatus["NOT_FOUND"] = "NOT_FOUND";
    GetTransactionStatus["FAILED"] = "FAILED";
    return GetTransactionStatus;
  }({});
  _SorobanRpc.GetTransactionStatus = GetTransactionStatus;
  function isSimulationError(sim) {
    return 'error' in sim;
  }
  _SorobanRpc.isSimulationError = isSimulationError;
  function isSimulationSuccess(sim) {
    return 'transactionData' in sim;
  }
  _SorobanRpc.isSimulationSuccess = isSimulationSuccess;
  function isSimulationRestore(sim) {
    return isSimulationSuccess(sim) && 'restorePreamble' in sim && !!sim.restorePreamble.transactionData;
  }
  _SorobanRpc.isSimulationRestore = isSimulationRestore;
  function isSimulationRaw(sim) {
    return !sim._parsed;
  }
  _SorobanRpc.isSimulationRaw = isSimulationRaw;
})(SorobanRpc || (exports.SorobanRpc = SorobanRpc = {}));