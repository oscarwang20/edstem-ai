import { type ComponentType, type ReactNode, Suspense } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

/**
 * HOC to wrap a component with an error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: ComponentType<P>,
  FallbackComponent: ComponentType<FallbackProps>
): ComponentType<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary FallbackComponent={FallbackComponent}>
        <Component {...props} />
      </ErrorBoundary>
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
    return (
      <Suspense fallback={fallback}>
        <Component {...props} />
      </Suspense>
    );
  };
}
