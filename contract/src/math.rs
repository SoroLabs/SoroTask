//! 128-bit fixed-point arithmetic with 18 decimal places of precision.

/// Scale factor: 10^18 (18 decimal places).
pub const FP_SCALE: i128 = 1_000_000_000_000_000_000;
pub const FP_SCALE_U128: u128 = 1_000_000_000_000_000_000;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct FixedPoint128 {
    /// Raw mantissa representing `value * FP_SCALE`.
    pub mantissa: i128,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MathError {
    Overflow,
    Underflow,
    DivisionByZero,
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

    /// `(numerator * multiplier) / divisor` — multiply before divide.
    pub fn mul_div(numerator: i128, multiplier: i128, divisor: i128) -> Result<i128, MathError> {
        if divisor == 0 {
            return Err(MathError::DivisionByZero);
        }
        let product = numerator
            .checked_mul(multiplier)
            .ok_or(MathError::Overflow)?;
        Ok(product / divisor)
    }

    /// Ceiling division: `ceil(numerator * multiplier / divisor)`.
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
        let q = product / divisor;
        let r = product % divisor;
        if r == 0 {
            Ok(q)
        } else if product > 0 {
            q.checked_add(1).ok_or(MathError::Overflow)
        } else {
            Ok(q)
        }
    }

    /// Floor division: `floor(numerator * multiplier / divisor)`.
    pub fn div_floor(numerator: i128, multiplier: i128, divisor: i128) -> Result<i128, MathError> {
        if divisor == 0 {
            return Err(MathError::DivisionByZero);
        }
        let product = numerator
            .checked_mul(multiplier)
            .ok_or(MathError::Overflow)?;
        Ok(product / divisor)
    }
}

/// Split an execution fee into protocol (ceil) and keeper (remainder) portions.
/// Guarantees `protocol + keeper == total` with zero dust.
pub fn split_execution_fee(total: i128, protocol_fee_bps: u32) -> Result<(i128, i128), MathError> {
    if total <= 0 {
        return Ok((0, 0));
    }
    let bps = protocol_fee_bps as i128;
    let protocol = FixedPoint128::div_ceil(total, bps, 10_000)?;
    let keeper = total
        .checked_sub(protocol)
        .ok_or(MathError::Underflow)?;
    Ok((protocol, keeper))
}

/// Yield accrual: `principal * rate_bps / 10_000` using floor (favor protocol).
pub fn accrue_yield_floor(principal: i128, rate_bps: u32) -> Result<i128, MathError> {
    FixedPoint128::div_floor(principal, rate_bps as i128, 10_000)
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
            assert_eq!(
                protocol + keeper,
                fee,
                "dust at fee={fee} iteration={i}"
            );
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
}
