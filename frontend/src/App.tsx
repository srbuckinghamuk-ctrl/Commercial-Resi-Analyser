import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Link, Navigate, useParams, useNavigate } from 'react-router-dom';
import type { Project } from './types';
import { listProjects } from './lib/api';

import Pipeline from './components/Pipeline';
import NewProject from './components/NewProject';
import ConversionCalculator from './components/ConversionCalculator';
import PropertyMap from './components/PropertyMap';
import ExportPage from './components/ExportPage';
import ProjectDetail from './components/ProjectDetail';

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Pipeline', end: true },
  { to: '/new', label: 'New Project' },
  { to: '/map', label: 'Map' },
  { to: '/export', label: 'Export' },
];

function ProjectRoute({
  projects,
  loading,
  backendOffline,
  onProjectsChanged,
  onRetry,
  view,
}: {
  projects: Project[];
  loading: boolean;
  backendOffline: boolean;
  onProjectsChanged: () => void;
  onRetry: () => void;
  view: 'overview' | 'eligibility' | 'calculator';
}) {
  const { id } = useParams<{ id: string }>();
  const project = projects.find((p) => p.id === id) ?? null;

  if (!project) {
    if (loading) {
      return <p style={{ padding: 24, color: '#94a3b8' }}>Loading project…</p>;
    }
    // A connection failure must never masquerade as a missing project.
    if (backendOffline) {
      return (
        <div style={{ padding: 24, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>Can't reach the server</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
            This project can't be loaded right now — it's a connection problem, not a missing
            project. Retrying automatically…
          </p>
          <button
            onClick={onRetry}
            style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Retry now
          </button>
        </div>
      );
    }
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>Project not found</h2>
        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
          It may have been deleted, or the link is out of date.
        </p>
        <Link to="/" style={{ color: '#60a5fa', fontSize: 14 }}>← Back to Pipeline</Link>
      </div>
    );
  }

  if (view === 'calculator') {
    return (
      <div>
        <Link
          to={`/projects/${project.id}`}
          style={{ display: 'inline-block', margin: '16px 24px 0', padding: '8px 16px', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb', borderRadius: 6, fontSize: 13, textDecoration: 'none' }}
        >
          ← Back to project
        </Link>
        <ConversionCalculator project={project} />
      </div>
    );
  }

  return <ProjectDetail project={project} view={view} onProjectUpdated={onProjectsChanged} />;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  const navigate = useNavigate();

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setBackendOffline(false);
    } catch {
      setBackendOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      await loadProjects();
      if (ignore) return;
    })();
    return () => {
      ignore = true;
    };
  }, [loadProjects]);

  // Keep retrying quietly while the backend is unreachable.
  useEffect(() => {
    if (!backendOffline) return;
    const timer = window.setInterval(() => {
      void loadProjects();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [backendOffline, loadProjects]);

  const handleProjectCreated = useCallback(
    (project: Project) => {
      // Insert the created project immediately so the detail page never
      // flashes "Project not found" while the background refetch runs.
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      void loadProjects();
      navigate(`/projects/${project.id}`);
    },
    [loadProjects, navigate],
  );

  return (
    <div style={{ minHeight: '100vh', background: '#050d18', color: '#e2e8f0' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #1e3a5f',
          background: '#0a1628',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          <Link to="/" style={{ color: '#e2e8f0', textDecoration: 'none' }}>Commercial to Resi</Link>
        </h1>
        {backendOffline && (
          <span role="status" style={{ color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            Can't reach the server — retrying…
            <button
              onClick={() => void loadProjects()}
              style={{ padding: '4px 12px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
            >
              Retry now
            </button>
          </span>
        )}
      </header>

      {/* Navigation */}
      <nav
        aria-label="Main"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0a1628',
          overflowX: 'auto',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
              padding: '10px 20px',
              borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
              color: isActive ? '#e2e8f0' : '#64748b',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Routes */}
      <main>
        <Routes>
          <Route
            path="/"
            element={<Pipeline projects={projects} loading={loading} backendOffline={backendOffline} onProjectsChanged={loadProjects} />}
          />
          <Route path="/new" element={<NewProject onProjectCreated={handleProjectCreated} />} />
          <Route
            path="/projects/:id"
            element={<ProjectRoute projects={projects} loading={loading} backendOffline={backendOffline} onProjectsChanged={loadProjects} onRetry={loadProjects} view="overview" />}
          />
          <Route
            path="/projects/:id/eligibility"
            element={<ProjectRoute projects={projects} loading={loading} backendOffline={backendOffline} onProjectsChanged={loadProjects} onRetry={loadProjects} view="eligibility" />}
          />
          <Route
            path="/projects/:id/calculator"
            element={<ProjectRoute projects={projects} loading={loading} backendOffline={backendOffline} onProjectsChanged={loadProjects} onRetry={loadProjects} view="calculator" />}
          />
          <Route path="/map" element={<PropertyMap projects={projects} projectsLoading={loading} backendOffline={backendOffline} />} />
          <Route path="/export" element={<ExportPage projects={projects} projectsLoading={loading} backendOffline={backendOffline} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
