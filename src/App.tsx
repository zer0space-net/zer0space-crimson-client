import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Catalogue from "./pages/Catalogue";
import Search from "./pages/Search";
import Overview from "./pages/Overview";
import Watch from "./pages/Watch";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="search" element={<Search />} />
        {/* kind = show | movie | anime */}
        <Route path="title/:kind/:id" element={<Overview />} />
        <Route path="watch/:kind/:id" element={<Watch />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
