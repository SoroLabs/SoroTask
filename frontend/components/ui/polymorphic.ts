import React from 'react';

type AsProp<T extends React.ElementType> = {
  as?: T;
};

type PropsToOmit<T extends React.ElementType, P> = keyof (AsProp<T> & P);

type PolymorphicComponentProp<T extends React.ElementType, P = {}> = React.PropsWithChildren<P> &
  AsProp<T> &
  Omit<React.ComponentPropsWithoutRef<T>, PropsToOmit<T, P>>;

type PolymorphicRef<T extends React.ElementType> = React.ComponentRef<T>;

type PolymorphicComponent<
  T extends React.ElementType,
  P = {}
> = React.ForwardRefExoticComponent<PolymorphicComponentProp<T, P>> & {
  displayName?: string;
};

function createPolymorphicComponent<
  T extends React.ElementType,
  P = {}
>(comp: React.ForwardRefExoticComponent<PolymorphicComponentProp<T, P>>, name?: string) {
  (comp as any).displayName = name;
  return comp as PolymorphicComponent<T, P>;
}

export function createA11yComponent<
  T extends React.ElementType = 'div',
  P = {}
>(Component: React.ElementType, fallback: React.ElementType, displayName: string) {
  const A11yComponent = React.forwardRef<
    PolymorphicRef<typeof fallback>,
    PolymorphicComponentProp<typeof fallback>
  >((props, ref) => {
    const { as, ...rest } = props as PolymorphicComponentProp<typeof fallback> & { as?: React.ElementType };
    return React.createElement(Component, { ...rest, ref });
  });

  return createPolymorphicComponent<typeof fallback, P>(A11yComponent as React.ForwardRefExoticComponent<PolymorphicComponentProp<typeof fallback, P>>, displayName);
}
