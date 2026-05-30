import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>PolizyDocs — authorization, made visible</title>
        <Meta />
        <Links />
      </head>
      <body className="bg-zinc-50 text-zinc-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Rendered while the app hydrates. There is no server data: each visitor's
 * database (a real Postgres, via PGlite) boots in their own browser, then the
 * route's `clientLoader` runs. This is what's on screen during that beat.
 */
export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-500">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
        <p className="text-sm">Booting Postgres in your browser…</p>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-xl font-semibold">{message}</h1>
      <p className="mt-2 text-zinc-600">{details}</p>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white p-4 text-sm">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
