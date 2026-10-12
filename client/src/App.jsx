import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useApp } from './components/ui.jsx';
import { homeFor, PROJECTS, WIDE } from './lib.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Deals from './pages/Deals.jsx';
import DealDetail from './pages/DealDetail.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Sharing from './pages/Sharing.jsx';
import Finance from './pages/Finance.jsx';
import Settings, { Members } from './pages/Settings.jsx';
import PrintDoc from './pages/PrintDoc.jsx';

export default function App() {
  const { user, meta } = useApp();
  if (user === undefined) return null;
  if (!user) return <Login />;
  if (!meta) return null;
  const home = homeFor(user.role);
  const only = (roles, el) => (roles.includes(user.role) ? el : <Navigate to={home} replace />);

  return (
    <Routes>
      <Route path="/print/:id" element={<PrintDoc />} />
      <Route element={<Layout />}>
        <Route index element={only([...WIDE, 'staff'], <Dashboard />)} />
        <Route path="deals" element={<Deals />} />
        <Route path="deals/:id" element={<DealDetail />} />
        <Route path="projects" element={only(PROJECTS, <Projects />)} />
        <Route path="projects/:id" element={only(PROJECTS, <ProjectDetail />)} />
        <Route path="sharing" element={only(WIDE, <Sharing />)} />
        <Route path="finance" element={only(WIDE, <Finance />)} />
        <Route path="members" element={only(['admin'], <Members />)} />
        <Route path="settings" element={only(['admin'], <Settings />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
