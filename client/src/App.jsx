import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useApp } from './components/ui.jsx';
import { canEditDemo, homeFor, PROJECTS, WIDE } from './lib.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Deals from './pages/Deals.jsx';
import DealDetail from './pages/DealDetail.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Sharing from './pages/Sharing.jsx';
import Finance from './pages/Finance.jsx';
import Settings, { Members } from './pages/Settings.jsx';
import DemoEditor, { Demos } from './pages/Demos.jsx';
import PrintDoc from './pages/PrintDoc.jsx';
import TimelinePrint from './pages/TimelinePrint.jsx';
import NotificationsPage from './pages/Notifications.jsx';

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
      <Route path="/print/timeline/:id" element={only(PROJECTS, <TimelinePrint />)} />
      <Route element={<Layout />}>
        <Route index element={only([...WIDE, 'staff'], <Dashboard />)} />
        <Route path="deals" element={<Deals />} />
        <Route path="deals/:id" element={<DealDetail />} />
        <Route path="projects" element={only(PROJECTS, <Projects />)} />
        <Route path="projects/:id" element={only(PROJECTS, <ProjectDetail />)} />
        <Route path="sharing" element={only(WIDE, <Sharing />)} />
        <Route path="finance" element={only(WIDE, <Finance />)} />
        <Route path="demos" element={canEditDemo(user) ? <Demos /> : <Navigate to={home} replace />} />
        <Route path="demos/:id" element={canEditDemo(user) ? <DemoEditor /> : <Navigate to={home} replace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="members" element={only(['admin'], <Members />)} />
        <Route path="settings" element={only(['admin'], <Settings />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
