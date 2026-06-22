import { AccessTester } from "./AccessTester.tsx";
import { Header } from "./Header.tsx";
import { MembersPanel } from "./MembersPanel.tsx";
import { PermissionsMatrix } from "./PermissionsMatrix.tsx";
import { TupleInspector } from "./TupleInspector.tsx";

export function App() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <Header />
      <div className="space-y-6">
        <PermissionsMatrix />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <AccessTester />
          </div>
          <div className="lg:col-span-3">
            <MembersPanel />
          </div>
        </div>
        <TupleInspector />
        <footer className="pt-2 text-center text-[12px] text-slate-400">
          Powered by <span className="font-medium text-slate-500">polizy</span>{" "}
          ·{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
            withRoleScaffold
          </code>{" "}
          +{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
            RoleRegistry
          </code>{" "}
          over an in-memory adapter, running entirely in your browser.
        </footer>
      </div>
    </div>
  );
}
