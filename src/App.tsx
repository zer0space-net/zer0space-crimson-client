import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Home from "./pages/Home";

// Only Home is in the initial bundle — it is what every visit lands on. The rest
// are split out so they download on navigation instead of before first paint.
// Watch matters most: it pulls in hls.js, which is dead weight on every other
// page and was a large part of the single 800 kB chunk this app used to ship.
const Catalogue = lazy(() => import("./pages/Catalogue"));
const Search = lazy(() => import("./pages/Search"));
const Library = lazy(() => import("./pages/Library"));
const Overview = lazy(() => import("./pages/Overview"));
const Watch = lazy(() => import("./pages/Watch"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="catalogue" element={<L2><Catalogue /></L2>} />
        <Route path="search" element={<L2><Search /></L2>} />
        <Route path="library" element={<L2><Library /></L2>} />
        <Route path="settings" element={<L2><Settings /></L2>} />
        {/* kind = show | movie | anime */}
        <Route path="title/:kind/:id" element={<L2><Overview /></L2>} />
        <Route path="watch/:kind/:id" element={<L2><Watch /></L2>} />
        <Route path="*" element={<L2><NotFound /></L2>} />
      </Route>
    </Routes>
  );
}

// Shared boundary for the lazily-loaded routes: the chunk fetch is fast on a warm
// cache but must still have something to show on a cold one.
function L2({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}
