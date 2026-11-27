//! 128-bit fixed-point arithmetic with 18 decimal places of precision.

/// Scale factor: 10^18 (18 decimal places).
pub const FP_SCALE: i128 = 1_000_000_000_000_000_000;
pub const FP_SCALE_U128: u128 = 1_000_000_000_000_000_000;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct FixedPoint128 {
    /// Raw mantissa representing `value * FP_SCALE`.
    pub mantissa: i128,
}

/// Basis-points denominator (100% = 10_000 bps).
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Result of a zero-dust three-way gas escrow split.
///
/// Guarantees:
/// - `protocol_fee >= 0`
/// - `keeper_reward >= 0`
/// - `refund_amount >= 0`
/// - `protocol_fee + keeper_reward == effective_consumed`
/// - `protocol_fee + keeper_reward + refund_amount == gas_allocated`
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct GasEscrowSplit {
    pub protocol_fee: i128,
    pub keeper_reward: i128,
    pub refund_amount: i128,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MathError {
    Overflow,
    Underflow,
    DivisionByZero,
    InvalidBps,
}

impl FixedPoint128 {
    #[inline]
    pub const fn from_raw(mantissa: i128) -> Self {
        Self { mantissa }
    }

    #[inline]
    pub const fn from_whole(whole: i128) -> Result<Self, MathError> {
        match whole.checked_mul(FP_SCALE) {
            Some(m) => Ok(Self { mantissa: m }),
            None => Err(MathError::Overflow),
        }
    }

    /// `(a * b) / FP_SCALE` with 128-bit guards.
    #[allow(clippy::should_implement_trait)]
    pub fn mul(a: Self, b: Self) -> Result<Self, MathError> {
        let product = a
            .mantissa
            .checked_mul(b.mantissa)
            .ok_or(MathError::Overflow)?;
        let scaled = product
            .checked_div(FP_SCALE)
            .ok_or(MathError::DivisionByZero)?;
        Ok(Self { mantissa: scaled })
    }

    /// `(numerator * multiplier) / divisor` — multiply before divide, with checked arithmetic.
    pub fn mul_div(numerator: i128, multiplier: i128, divisor: i128) -> Result<i128, MathError> {
        if divisor == 0 {
            return Err(MathError::DivisionByZero);
        }
        let product = numerator
            .checked_mul(multiplier)
            .ok_or(MathError::Overflow)?;
        product.checked_div(divisor).ok_or(MathError::Overflow)
    }

    /// Ceiling division: `ceil(numerator * multiplier / divisor)`.
    ///
    /// Exact for all signed `i128` inputs without overflow or underflow.
    pub fn div_ceil(numerator: i128, multiplier: i128, divisor: i128) -> Result<i128, MathError> {
        if divisor == 0 {
            return Err(MathError::DivisionByZero);
        }
        if numerator == 0 || multiplier == 0 {
            return Ok(0);
        }
        let product = numerator
            .checked_mul(multiplier)
            .ok_or(MathError::Overflow)?;
        let q = product.checked_div(divisor).ok_or(MathError::Overflow)?;
        let r = product.checked_rem(divisor).ok_or(MathError::Overflow)?;
        if r != 0 && (product > 0) == (divisor > 0) {
            q.checked_add(1).ok_or(MathError::Overflow)
        } else {
            Ok(q)
        }
    }

    /// Floor division: `floor(numerator * multiplier / divisor)`.
    ///
    /// Exact for all signed `i128` inputs without overflow or underflow.
    pub fn div_floor(numerator: i128, multiplier: i128, divisor: i128) -> Result<i128, MathError> {
        if divisor == 0 {
            return Err(MathError::DivisionByZero);
        }
        if numerator == 0 || multiplier == 0 {
            return Ok(0);
        }
        let product = numerator
            .checked_mul(multiplier)
            .ok_or(MathError::Overflow)?;
        let q = product.checked_div(divisor).ok_or(MathError::Overflow)?;
        let r = product.checked_rem(divisor).ok_or(MathError::Overflow)?;
        if r != 0 && (product > 0) != (divisor > 0) {
            q.checked_sub(1).ok_or(MathError::Underflow)
        } else {
            Ok(q)
        }
    }
}

/// Split an execution fee into protocol () and keeper () portions.
///
/// Guarantees  with zero dust and no overflow/underflow.
pub fn split_execution_fee(total: i128, protocol_fee_bps: u32) -> Result<(i128, i128), MathError> {
    if protocol_fee_bps > BPS_DENOMINATOR as u32 {
        return Err(MathError::InvalidBps);
    }
    if total < 0 {
        return Err(MathError::Underflow);
    }
    if total == 0 {
        return Ok((0, 0));
    }
    let protocol_bps = protocol_fee_bps as i128;
    let keeper_bps = BPS_DENOMINATOR
        .checked_sub(protocol_bps)
        .ok_or(MathError::Underflow)?;
    let protocol = FixedPoint128::div_ceil(total, protocol_bps, BPS_DENOMINATOR)?;
    let keeper = FixedPoint128::div_floor(total, keeper_bps, BPS_DENOMINATOR)?;
    // Mathematical identity: ceil(total * b / B) + floor(total * (B - b) / B) == total.
    debug_assert_eq!(protocol.checked_add(keeper), Some(total));
    Ok((protocol, keeper))
}

/// Three-way zero-dust split of a gas escrow allocation into:
/// - `protocol_fee`: ceiling share of consumed gas (`div_ceil`)
/// - `keeper_reward`: floor share of consumed gas (`div_floor`)
/// - `refund_amount`: exact unspent escrow returned to the creator
///
/// Guarantees:
/// `protocol_fee + keeper_reward + refund_amount == gas_allocated`
/// down to the single stroop, with underflow and overflow mathematically impossible.
pub fn split_gas_escrow(
    gas_allocated: i128,
    gas_consumed: i128,
    protocol_fee_bps: u32,
) -> Result<GasEscrowSplit, MathError> {
    if gas_allocated < 0 || gas_consumed < 0 {
        return Err(MathError::Underflow);
    }
    if protocol_fee_bps > BPS_DENOMINATOR as u32 {
        return Err(MathError::InvalidBps);
    }
    let effective_consumed = gas_consumed.min(gas_allocated);
    let refund_amount = gas_allocated
        .checked_sub(effective_consumed)
        .ok_or(MathError::Underflow)?;
    let (protocol_fee, keeper_reward) = split_execution_fee(effective_consumed, protocol_fee_bps)?;
    Ok(GasEscrowSplit {
        protocol_fee,
        keeper_reward,
        refund_amount,
    })
}

/// Yield accrual: `principal * rate_bps / 10_000` using floor (favor protocol).
pub fn accrue_yield_floor(principal: i128, rate_bps: u32) -> Result<i128, MathError> {
    FixedPoint128::div_floor(principal, rate_bps as i128, BPS_DENOMINATOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn div_ceil_rounds_up_for_protocol_fees() {
        // 1 unit fee at 333 bps => ceil(333/10000) = 1
        assert_eq!(FixedPoint128::div_ceil(1, 333, 10_000).unwrap(), 1);
        // 100 fee at 500 bps (5%) => 5
        assert_eq!(FixedPoint128::div_ceil(100, 500, 10_000).unwrap(), 5);
        // 99 fee at 500 bps => ceil(4.95) = 5
        assert_eq!(FixedPoint128::div_ceil(99, 500, 10_000).unwrap(), 5);
    }

    #[test]
    fn div_floor_rounds_down_for_keeper_bounties() {
        assert_eq!(FixedPoint128::div_floor(99, 9500, 10_000).unwrap(), 94);
        assert_eq!(FixedPoint128::div_floor(100, 9500, 10_000).unwrap(), 95);
    }

    #[test]
    fn split_execution_fee_has_zero_dust() {
        let bps = 333u32;
        let mut total_distributed = 0i128;
        for fee in 1..=10_000i128 {
            let (protocol, keeper) = split_execution_fee(fee, bps).unwrap();
            assert_eq!(protocol + keeper, fee);
            total_distributed += protocol + keeper;
        }
        assert!(total_distributed > 0);
    }

    #[test]
    fn stress_one_million_reward_splits_zero_dust() {
        let bps = 500u32;
        let mut i = 0i128;
        while i < 1_000_000 {
            let fee = (i % 10_000) + 1;
            let (protocol, keeper) = split_execution_fee(fee, bps).unwrap();
            assert_eq!(protocol + keeper, fee, "dust at fee={fee} iteration={i}");
            i += 1;
        }
    }

    #[test]
    fn mul_detects_overflow() {
        let max = i128::MAX / FP_SCALE;
        let a = FixedPoint128::from_whole(max).unwrap();
        let b = FixedPoint128::from_whole(2).unwrap();
        assert!(FixedPoint128::mul(a, b).is_err());
    }

    #[test]
    fn from_whole_and_mul_preserves_value() {
        let a = FixedPoint128::from_whole(42).unwrap();
        let one = FixedPoint128::from_raw(FP_SCALE);
        let result = FixedPoint128::mul(a, one).unwrap();
        assert_eq!(result.mantissa, 42 * FP_SCALE);
    }

    #[test]
    fn stress_one_million_gas_escrow_refund_splits_zero_dust() {
        let mut total_allocated: i128 = 0;
        let mut total_protocol: i128 = 0;
        let mut total_keeper: i128 = 0;
        let mut total_refunded: i128 = 0;

        let mut i: i128 = 0;
        while i < 1_000_000 {
            let allocated = (i % 100_000) + 1;
            let consumed = (i * 7919) % (allocated + 1);
            let bps = ((i * 37) % 10_001) as u32;

            let split = split_gas_escrow(allocated, consumed, bps).unwrap();
            assert!(split.protocol_fee >= 0);
            assert!(split.keeper_reward >= 0);
            assert!(split.refund_amount >= 0);
            assert_eq!(
                split.protocol_fee + split.keeper_reward + split.refund_amount,
                allocated,
                "dust detected at iteration {i}"
            );

            total_allocated += allocated;
            total_protocol += split.protocol_fee;
            total_keeper += split.keeper_reward;
            total_refunded += split.refund_amount;
            i += 1;
        }

        assert_eq!(
            total_protocol + total_keeper + total_refunded,
            total_allocated,
            "aggregate balance drift across 1,000,000 splits"
        );
    }

    #[test]
    fn overflow_and_underflow_are_rejected() {
        assert_eq!(split_execution_fee(-1, 500), Err(MathError::Underflow));
        assert_eq!(split_execution_fee(100, 10_001), Err(MathError::InvalidBps));
        assert_eq!(split_gas_escrow(-1, 0, 500), Err(MathError::Underflow));
        assert_eq!(split_gas_escrow(100, -1, 500), Err(MathError::Underflow));
        assert_eq!(split_gas_escrow(100, 50, 10_001), Err(MathError::InvalidBps));
        assert_eq!(
            FixedPoint128::div_ceil(i128::MAX, 2, 10_000),
            Err(MathError::Overflow)
        );
        assert_eq!(
            FixedPoint128::div_floor(i128::MAX, 2, 10_000),
            Err(MathError::Overflow)
        );
        assert_eq!(
            FixedPoint128::mul_div(i128::MIN, 1, -1),
            Err(MathError::Overflow)
        );
        assert_eq!(
            FixedPoint128::div_ceil(10, 5, 0),
            Err(MathError::DivisionByZero)
        );
        // Consumed exceeding allocated clamps safely without underflow
        let clamped = split_gas_escrow(1_000, 5_000, 333).unwrap();
        assert_eq!(clamped.refund_amount, 0);
        assert_eq!(clamped.protocol_fee + clamped.keeper_reward, 1_000);
    }

    mod proptest_invariants {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn prop_split_execution_fee_conserves_exact_balance(
                total in 0i128..=1_000_000_000_000_000i128,
                bps in 0u32..=10_000u32,
            ) {
                let (protocol, keeper) = split_execution_fee(total, bps).unwrap();
                prop_assert!(protocol >= 0);
                prop_assert!(keeper >= 0);
                prop_assert_eq!(protocol.checked_add(keeper), Some(total));
            }

            #[test]
            fn prop_split_gas_escrow_three_way_zero_dust(
                gas_allocated in 0i128..=1_000_000_000_000_000i128,
                gas_consumed in 0i128..=1_500_000_000_000_000i128,
                bps in 0u32..=10_000u32,
            ) {
                let split = split_gas_escrow(gas_allocated, gas_consumed, bps).unwrap();
                prop_assert!(split.protocol_fee >= 0);
                prop_assert!(split.keeper_reward >= 0);
                prop_assert!(split.refund_amount >= 0);
                let consumed_total = split.protocol_fee.checked_add(split.keeper_reward).unwrap();
                prop_assert_eq!(consumed_total, gas_consumed.min(gas_allocated));
                prop_assert_eq!(consumed_total.checked_add(split.refund_amount), Some(gas_allocated));
            }

            #[test]
            fn prop_div_ceil_and_div_floor_complementary(
                amount in 0i128..=1_000_000_000_000i128,
                bps in 0u32..=10_000u32,
            ) {
                let c = FixedPoint128::div_ceil(amount, bps as i128, BPS_DENOMINATOR).unwrap();
                let f = FixedPoint128::div_floor(amount, (10_000 - bps) as i128, BPS_DENOMINATOR).unwrap();
                prop_assert_eq!(c + f, amount);
            }
        }
    }
}
