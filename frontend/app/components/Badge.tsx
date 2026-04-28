import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

/**
 * Reusable Badge component using design tokens.
 * 
 * Usage:
 * ```tsx
 * <Badge variant="success">Success</Badge>
 * ```
 * 
 * Design Token Mapping:
 * - background: variant-specific color tokens
 * - border-radius: --badge-border-radius
 * - padding: --badge-padding-x, --badge-padding-y
 * - font-size: --badge-font-size
 * - font-weight: --badge-font-weight
 */
export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  children,
  className = '',
  ...props
}) => {
  const baseStyles = 'inline-flex items-center rounded-full font-medium';
  
  const variantStyles: Record<BadgeVariant, string> = {
    default: 'bg-neutral-200 text-neutral-700',
    success: 'bg-success-subtle text-success-500 border border-success-border',
    warning: 'bg-warning-subtle text-warning-500 border border-warning-border',
    error: 'bg-error-subtle text-error-500 border border-error-border',
    info: 'bg-info-subtle text-info-500 border border-info-border',
    neutral: 'bg-neutral-100 text-neutral-600',
  };
  
  const classes = [
    baseStyles,
    variantStyles[variant],
    'px-2.5 py-0.5 text-xs',
    className,
  ].filter(Boolean).join(' ');
  
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';