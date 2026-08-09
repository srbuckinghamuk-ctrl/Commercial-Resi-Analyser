import { useState, useEffect, useCallback } from 'react';
import type { Project } from './types';
import { listProjects } from './lib/api';

import Pipeline from './components/Pipeline';
import NewProject from './components/NewProject';
import EligibilityAssessment from './components/EligibilityAssessment';
import ConversionCalculator from './components/ConversionCalculator';
import PropertyMap from './components/PropertyMap';
import ExportPage from './components/ExportPage';

type Tab = 'pipeline' | 'new_project' | 'eligibility' | 'calculator' | 'map' | 'export';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'new_project', label: 'New Project' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'calculator', label: 'Calculator' },
  { key: 'map', label: 'Map' },
  { key: 'export', label: 'Export' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setBackendOffline(false);
    } catch {
      setBackendOffline(true);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = useCallback(() => {
    loadProjects();
    setActiveTab('pipeline');
  }, [loadProjects]);

  const handleSelectProject = useCallback((project: Project) => {
    setSelectedProject(project);
  }, []);

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
          Commercial-Resi-Analyser
        </h1>
        {backendOffline && (
          <span style={{ color: '#ef4444', fontSize: 13 }}>Backend offline</span>
        )}
      </header>

      {/* Tab Navigation */}
      <nav
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0a1628',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#e2e8f0' : '#64748b',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <main>
        {activeTab === 'pipeline' && (
          <Pipeline projects={projects} onSelectProject={handleSelectProject} onProjectsChanged={loadProjects} />
        )}
        {activeTab === 'new_project' && (
          <NewProject onProjectCreated={handleProjectCreated} />
        )}
        {activeTab === 'eligibility' && (
          <EligibilityAssessment projects={projects} selectedProject={selectedProject} />
        )}
        {activeTab === 'calculator' && <ConversionCalculator project={selectedProject} />}
        {activeTab === 'map' && (
          <PropertyMap projects={projects} selectedProject={selectedProject} onSelectProject={handleSelectProject} />
        )}
        {activeTab === 'export' && <ExportPage projects={projects} selectedProject={selectedProject} />}
      </main>
    </div>
  );
}
