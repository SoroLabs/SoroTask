import { createHash } from 'crypto';

interface GasPricePoint {
  timestamp: number;
  gasPrice: number;
  volume: number;
}

interface OptionsVault {
  id: string;
  strikePrice: number;
  premium: number;
  expiry: number;
  notional: number;
  status: 'active' | 'expired' | 'exercised';
}

interface HedgingResult {
  unhedgedCost: number;
  hedgedCost: number;
  premiumPaid: number;
  savings: number;
  confidence: number;
}

interface BlackScholesResult {
  optionPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export class GasHedgingSimulator {
  private historicalData: GasPricePoint[] = [];
  private vaults: Map<string, OptionsVault> = new Map();
  private riskFreeRate: number = 0.05;

  addHistoricalData(points: GasPricePoint[]) {
    this.historicalData.push(...points);
  }

  calculateVolatility(days: number = 30): number {
    const recentData = this.historicalData.slice(-days);
    if (recentData.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < recentData.length; i++) {
      const returnRatio = recentData[i].gasPrice / recentData[i - 1].gasPrice;
      returns.push(Math.log(returnRatio));
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(365);
  }

  blackScholes(
    spotPrice: number,
    strikePrice: number,
    timeToExpiry: number,
    volatility: number,
    optionType: 'call' | 'put'
  ): BlackScholesResult {
    const d1 =
      (Math.log(spotPrice / strikePrice) +
        (this.riskFreeRate + 0.5 * volatility ** 2) * timeToExpiry) /
      (volatility * Math.sqrt(timeToExpiry));
    const d2 = d1 - volatility * Math.sqrt(timeToExpiry);

    const norm = (x: number) =>
      0.5 * (1 + erf(x / Math.SQRT2));

    const callPrice =
      spotPrice * norm(d1) - strikePrice * Math.exp(-this.riskFreeRate * timeToExpiry) * norm(d2);

    const putPrice =
      strikePrice * Math.exp(-this.riskFreeRate * timeToExpiry) * norm(-d2) -
      spotPrice * norm(-d1);

    return {
      optionPrice: optionType === 'call' ? callPrice : putPrice,
      delta: optionType === 'call' ? norm(d1) : norm(d1) - 1,
      gamma: (Math.exp(-0.5 * d1 ** 2)) / (spotPrice * volatility * Math.sqrt(2 * Math.PI * timeToExpiry)),
      theta:
        -(spotPrice * Math.exp(-0.5 * d1 ** 2) * volatility) /
        (2 * Math.sqrt(2 * Math.PI * timeToExpiry)),
      vega:
        spotPrice * Math.exp(-0.5 * d1 ** 2) * Math.sqrt(timeToExpiry) /
        (Math.sqrt(2 * Math.PI)),
    };
  }

  createOptionsVault(
    strikePrice: number,
    premium: number,
    expiryDays: number,
    notional: number
  ): OptionsVault {
    const vaultId = `vault_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const vault: OptionsVault = {
      id: vaultId,
      strikePrice,
      premium,
      expiry: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
      notional,
      status: 'active',
    };

    this.vaults.set(vaultId, vault);
    return vault;
  }

  calculateHedgedBudget(
    currentGasPrice: number,
    strikePrice: number,
    volatility: number,
    days: number
  ): HedgingResult {
    const bsResult = this.blackScholes(
      currentGasPrice,
      strikePrice,
      days / 365,
      volatility,
      'call'
    );

    const premium = bsResult.optionPrice;
    const optionCost = premium * (1000000 / strikePrice);

    const unhedgedScenarios = this.simulateGasPrices(currentGasPrice, volatility, days);
    const hedgedScenarios = unhedgedScenarios.map((price) =>
      Math.min(price, strikePrice) + optionCost
    );

    const unhedgedCost =
      unhedgedScenarios.reduce((a, b) => a + b, 0) / unhedgedScenarios.length;
    const hedgedCost =
      hedgedScenarios.reduce((a, b) => a + b, 0) / hedgedScenarios.length;

    return {
      unhedgedCost,
      hedgedCost,
      premiumPaid: optionCost,
      savings: unhedgedCost - hedgedCost,
      confidence: this.calculateConfidence(unhedgedScenarios),
    };
  }

  private simulateGasPrices(
    currentPrice: number,
    volatility: number,
    days: number
  ): number[] {
    const scenarios: number[] = [];
    const simulations = 90;

    for (let i = 0; i < simulations; i++) {
      let price = currentPrice;
      for (let d = 0; d < days; d++) {
        const drift = this.riskFreeRate * price * 0.01;
        const shock =
          volatility * price * (Math.random() * 2 - 1) * Math.sqrt(1 / 365);
        price = Math.max(price + drift + shock, 0.001);
      }
      scenarios.push(price);
    }

    return scenarios;
  }

  private calculateConfidence(scenarios: number[]): number {
    const mean = scenarios.reduce((a, b) => a + b, 0) / scenarios.length;
    const variance =
      scenarios.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scenarios.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;
    return Math.max(0, Math.min(1, 1 - cv));
  }

  get90DayForecast(): {
    historical: GasPricePoint[];
    unhedgedCumulative: number;
    hedgedCumulative: number;
    savings: number;
    volatility: number;
  } {
    const volatility = this.calculateVolatility(30);
    const historical = this.historicalData.slice(-90);

    let unhedgedCumulative = 0;
    let hedgedCumulative = 0;
    const lastPrice = historical[historical.length - 1]?.gasPrice || 0;

    for (const point of historical) {
      unhedgedCumulative += point.gasPrice;
      const hedged = Math.min(point.gasPrice, 0.001 * Math.exp(volatility * 30));
      hedgedCumulative += hedged;
    }

    const vaults = Array.from(this.vaults.values()).filter(
      (v) => v.status === 'active'
    );
    const totalPremium = vaults.reduce((sum, v) => sum + v.premium, 0);

    return {
      historical,
      unhedgedCumulative,
      hedgedCumulative,
      savings: unhedgedCumulative - hedgedCumulative,
      volatility,
    };
  }

  getVaultStatus(vaultId: string): OptionsVault | undefined {
    return this.vaults.get(vaultId);
  }

  closeVault(vaultId: string): boolean {
    const vault = this.vaults.get(vaultId);
    if (!vault) return false;
    vault.status = 'expired';
    return true;
  }
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1 / (1 + p * x);
  const y =
    1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}
export { erf };
