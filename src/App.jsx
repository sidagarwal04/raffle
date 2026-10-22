import { Route, Routes } from "react-router-dom";
import { Create } from "./pages/Create.jsx";
import { Home } from "./pages/Home.jsx";
import { Join } from "./pages/Join.jsx";
import { Stage } from "./pages/Stage.jsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/draw" element={<Create />} />
      <Route path="/s/:code" element={<Stage />} />
      <Route path="/j/:code" element={<Join />} />
      <Route
        path="*"
        element={
          <main className="sheet">
            <p className="mark">Spin Fiesta</p>
            <h1>That page isn’t here.</h1>
            <a className="btn primary" href="/">
              Back home
            </a>
          </main>
        }
      />
    </Routes>
  );
}
