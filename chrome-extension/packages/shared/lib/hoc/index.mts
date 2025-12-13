import { type ComponentType, type ReactNode, Suspense, createElement } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

/**
 * HOC to wrap a component with an error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: ComponentType<P>,
  FallbackComponent: ComponentType<FallbackProps>
): ComponentType<P> {
  return function WithErrorBoundary(props: P) {
    return createElement(
      ErrorBoundary,
      { FallbackComponent },
      createElement(Component, props)
    );
  };
}

/**
 * HOC to wrap a component with Suspense
 */
export function withSuspense<P extends object>(
  Component: ComponentType<P>,
  fallback: ReactNode
): ComponentType<P> {
  return function WithSuspense(props: P) {
    return createElement(
      Suspense,
      { fallback },
      createElement(Component, props)
    );
  };
}
