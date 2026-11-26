#![no_main]

use libfuzzer_sys::fuzz_target;
use soro_task_contract::math::{
    accrue_yield_floor, split_execution_fee, FixedPoint128, FP_SCALE,
};

/// Fuzz every fixed-point and fee-division primitive with arbitrary `i128`
/// inputs, zero divisors, `0` bps, `10_000` bps, `> 10_000` bps, `i128::MIN`,
/// and `i128::MAX`.
///
/// Input layout (52 bytes):
///   [0..16]  a   (i128 LE)
///   [16..32] b   (i128 LE)
///   [32..48] d   (i128 LE)
///   [48..52] bps (u32 LE)
fuzz_target!(|data: &[u8]| {
    if data.len() < 52 {
        return;
    }

    let a = i128::from_le_bytes(data[0..16].try_into().unwrap());
    let b = i128::from_le_bytes(data[16..32].try_into().unwrap());
    let d = i128::from_le_bytes(data[32..48].try_into().unwrap());
    let bps = u32::from_le_bytes(data[48..52].try_into().unwrap());

    let _ = FixedPoint128::from_whole(a);
    let _ = FixedPoint128::mul(FixedPoint128::from_raw(a), FixedPoint128::from_raw(b));
    let _ = FixedPoint128::mul(FixedPoint128::from_raw(a), FixedPoint128::from_raw(FP_SCALE));
    let _ = FixedPoint128::mul_div(a, b, d);
    let _ = FixedPoint128::div_ceil(a, b, d);
    let _ = FixedPoint128::div_floor(a, b, d);

    if let Ok((protocol, keeper)) = split_execution_fee(a, bps) {
        if a > 0 {
            assert_eq!(protocol + keeper, a);
            assert!(protocol >= 0);
            assert!(keeper >= 0);
            if bps == 0 {
                assert_eq!(protocol, 0);
                assert_eq!(keeper, a);
            }
            if bps == 10_000 {
                assert_eq!(protocol, a);
                assert_eq!(keeper, 0);
            }
        } else {
            assert_eq!((protocol, keeper), (0, 0));
        }
    }

    let _ = accrue_yield_floor(a, bps);
});
