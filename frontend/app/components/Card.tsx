import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'elevated';
  padding?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Reusable Card component using design tokens.
 * 
 * Usage:
 * ```tsx
 * <Card variant="elevated" padding="lg">
 *   <h3>Card Title</h3>
 *   <p>Card content</p>
 * </Card>
 * ```
 * 
 * Design Token Mapping:
 * - background: --color-surface-card
 * - border: --color-border
 * - border-radius: --card-border-radius
 * - padding: --card-padding (size-dependent)
 * - box-shadow: --card-shadow
 */
export const Card: React.FC<CardProps> = ({
  variant = 'default',
  padding = 'md',
  children,
  className = '',
  ...props
}) => {
  const baseStyles = 'border border-solid';
  
  const variantStyles: Record<string, string> = {
    default: 'bg-card border-border',
    elevated: 'bg-card border-border shadow-xl',
  };
  
  const paddingStyles: Record<string, string> = {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
    xl: 'p-10',
  };
  
  const radiusStyles = 'rounded-xl';
  
  const classes = [
    baseStyles,
    variantStyles[variant!],
    paddingStyles[padding!],
    radiusStyles,
    className,
  ].filter(Boolean).join(' ');
  
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

Card.displayName = 'Card';