import { ActionDefinition } from './types';

export const PREDEFINED_ACTIONS: ActionDefinition[] = [
  {
    id: 'harvest-yield',
    label: 'Harvest Yield',
    description: 'Claim accumulated yield from a liquidity pool.',
    category: 'defi',
    icon: '🌾',
    functionName: 'harvest',
    inputs: [
      { name: 'pool_id', type: 'address' },
      { name: 'min_amount', type: 'i128', optional: true },
    ],
  },
  {
    id: 'token-transfer',
    label: 'Token Transfer',
    description: 'Transfer a token amount to a target address.',
    category: 'transfer',
    icon: '💸',
    functionName: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'i128' },
    ],
  },
  {
    id: 'swap',
    label: 'DEX Swap',
    description: 'Swap tokens on a Soroban DEX.',
    category: 'defi',
    icon: '🔄',
    functionName: 'swap',
    inputs: [
      { name: 'token_in', type: 'address' },
      { name: 'token_out', type: 'address' },
      { name: 'amount_in', type: 'i128' },
      { name: 'min_amount_out', type: 'i128' },
    ],
  },
  {
    id: 'stake',
    label: 'Stake Tokens',
    description: 'Stake tokens into a staking contract.',
    category: 'defi',
    icon: '🔒',
    functionName: 'stake',
    inputs: [{ name: 'amount', type: 'i128' }],
  },
  {
    id: 'cast-vote',
    label: 'Cast Vote',
    description: 'Vote on an on-chain governance proposal.',
    category: 'governance',
    icon: '🗳️',
    functionName: 'vote',
    inputs: [
      { name: 'proposal_id', type: 'u64' },
      { name: 'support', type: 'bool' },
    ],
  },
];
