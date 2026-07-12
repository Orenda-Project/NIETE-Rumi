/**
 * PortalTraining — 3-step cascading picker for teacher training modules.
 *
 *     Level ▼          Course ▼          Module ▼
 *   (with progress   (with progress   (✓ / ○ per
 *    per level)       per course)     module)
 *
 * Mirrors PortalCurriculum's UX. Read-only: teachers still mark modules
 * done via WhatsApp (existing training flow); the portal is for browsing
 * and recap.
 *
 * When a module is selected the detail card shows:
 *   - title, duration, completion badge
 *   - ▶ Watch Video button (opens presigned R2 URL in new tab)
 *   - 🎧 Play Audio button (if audio_url present)
 *   - content_html rendered inline (sanitized) when present
 */

import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { GraduationCap, Play, Headphones, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type Level = { id: number; name: string; order_index: number; cpd_level: number | null; module_count: number; completed_count: number };
type Course = { id: string; title: string; course_type: string; order_index: number; module_count: number; completed_count: number };
type ModuleSummary = { id: string; title: string; order_index: number; duration_seconds: number; has_video: boolean; has_audio: boolean; completed_at: string | null };
type ModuleDetail = {
  id: string; title: string; content_html: string;
  video_url: string | null; audio_url: string | null;
  duration_seconds: number; order_index: number; completed_at: string | null;
  course: { id: string; title: string } | null;
  level: { id: number; name: string } | null;
};

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m}m ${s}s`;
}

const PortalTraining = () => {
  const { toast } = useToast();

  const [levels, setLevels] = useState<Level[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>('');

  const [loadingLevels, setLoadingLevels] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Fetch levels on mount
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/training/levels');
        setLevels(data.levels || []);
      } catch {
        toast({ title: 'Could not load training levels', variant: 'destructive' });
      } finally { setLoadingLevels(false); }
    })();
  }, [toast]);

  // Level → courses
  useEffect(() => {
    setCourses([]); setModules([]); setModuleDetail(null);
    setSelectedCourse(''); setSelectedModule('');
    if (!selectedLevel) return;
    (async () => {
      setLoadingCourses(true);
      try {
        const { data } = await api.get('/training/courses', { params: { level_id: selectedLevel } });
        setCourses(data.courses || []);
      } catch {
        toast({ title: 'Could not load courses', variant: 'destructive' });
      } finally { setLoadingCourses(false); }
    })();
  }, [selectedLevel, toast]);

  // Course → modules
  useEffect(() => {
    setModules([]); setModuleDetail(null);
    setSelectedModule('');
    if (!selectedCourse) return;
    (async () => {
      setLoadingModules(true);
      try {
        const { data } = await api.get('/training/modules', { params: { course_id: selectedCourse } });
        setModules(data.modules || []);
      } catch {
        toast({ title: 'Could not load modules', variant: 'destructive' });
      } finally { setLoadingModules(false); }
    })();
  }, [selectedCourse, toast]);

  // Module → detail
  useEffect(() => {
    setModuleDetail(null);
    if (!selectedModule) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const { data } = await api.get(`/training/module/${selectedModule}`);
        setModuleDetail(data.module);
      } catch {
        toast({ title: 'Could not load module', variant: 'destructive' });
      } finally { setLoadingDetail(false); }
    })();
  }, [selectedModule, toast]);

  const openMedia = useCallback((url: string | null) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }, []);

  if (loadingLevels) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <GraduationCap className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-light">Teacher Training</h1>
          </div>
          <p className="text-muted-foreground">
            Browse your training levels, courses, and modules. Mark modules complete via WhatsApp.
          </p>
        </div>

        {/* Cascading picker */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Level */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">1. Level</label>
            <Select value={selectedLevel} onValueChange={setSelectedLevel}>
              <SelectTrigger><SelectValue placeholder="Select level..." /></SelectTrigger>
              <SelectContent>
                {levels.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    <span className="font-medium">{l.name}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      · {l.completed_count}/{l.module_count} done
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Course */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">2. Course</label>
            <Select value={selectedCourse} onValueChange={setSelectedCourse} disabled={!selectedLevel || loadingCourses}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedLevel ? 'Select level first' :
                  loadingCourses ? 'Loading...' :
                  courses.length === 0 ? 'No courses' : 'Select course...'
                } />
              </SelectTrigger>
              <SelectContent>
                {courses.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-medium">{c.title}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      · {c.completed_count}/{c.module_count} done
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Module */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">3. Module</label>
            <Select value={selectedModule} onValueChange={setSelectedModule} disabled={!selectedCourse || loadingModules}>
              <SelectTrigger>
                <SelectValue placeholder={
                  !selectedCourse ? 'Select course first' :
                  loadingModules ? 'Loading...' :
                  modules.length === 0 ? 'No modules' : 'Select module...'
                } />
              </SelectTrigger>
              <SelectContent>
                {modules.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="mr-1">{m.completed_at ? '✓' : '○'}</span>
                    <span className="font-medium">{m.title}</span>
                    {m.duration_seconds > 0 && (
                      <span className="text-muted-foreground text-xs ml-2">· {formatDuration(m.duration_seconds)}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Detail card */}
        {loadingDetail && (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {moduleDetail && !loadingDetail && (
          <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                {moduleDetail.level && moduleDetail.course && (
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {moduleDetail.level.name} · {moduleDetail.course.title}
                  </div>
                )}
                <h2 className="text-xl font-medium">{moduleDetail.title}</h2>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  {moduleDetail.duration_seconds > 0 && <span>{formatDuration(moduleDetail.duration_seconds)}</span>}
                  {moduleDetail.completed_at ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="w-4 h-4" /> Completed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Circle className="w-4 h-4" /> Not yet
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Media buttons */}
            <div className="flex flex-wrap gap-2">
              {moduleDetail.video_url && (
                <Button onClick={() => openMedia(moduleDetail.video_url)} className="flex items-center gap-2">
                  <Play className="w-4 h-4" /> Watch Video
                </Button>
              )}
              {moduleDetail.audio_url && (
                <Button variant="outline" onClick={() => openMedia(moduleDetail.audio_url)} className="flex items-center gap-2">
                  <Headphones className="w-4 h-4" /> Play Audio
                </Button>
              )}
            </div>

            {/* HTML content */}
            {moduleDetail.content_html && moduleDetail.content_html.trim().length > 0 ? (
              <div
                className="prose prose-sm max-w-none border-t pt-4"
                // eslint-disable-next-line react/no-danger — DOMPurify sanitises before render
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(moduleDetail.content_html) }}
              />
            ) : (
              !moduleDetail.video_url && !moduleDetail.audio_url && (
                <p className="text-sm text-muted-foreground border-t pt-4">
                  This module has no readable content yet. It's likely a checkpoint or reflection module.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalTraining;
