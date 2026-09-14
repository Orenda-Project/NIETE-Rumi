import { useState, useEffect, useCallback } from 'react';
import { School, Plus, UserCheck, Users, X, ChevronDown, ChevronRight } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { classes as classesApi } from '../services/api';
import { useToast } from '@/hooks/use-toast';
import type { TeacherClass, ClassOption, RosterStudent } from '../types/portal';

/**
 * The teacher's classes, and the form to add one.
 *
 * Scope is TEACHER-OWNED classes only — a principal's or coach's view of a
 * school's classes is deliberately not here yet.
 *
 * Two things this page deliberately does NOT do:
 *
 *   - It keeps no copy of the grade or subject vocabulary. Options and labels
 *     arrive from the API already localised for this teacher, because the labels
 *     live in one catalog in the bot process. A second list here would be a third
 *     vocabulary, and the seed already had to reconcile five.
 *   - It does not offer the add form when the account cannot satisfy it. About one
 *     teacher in eight has no school on file, and a class requires one; showing a
 *     form that always fails is worse than explaining why.
 */
const PortalClasses = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<TeacherClass[]>([]);
  const [grades, setGrades] = useState<ClassOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<ClassOption[]>([]);
  const [sectionOptions, setSectionOptions] = useState<ClassOption[]>([]);
  const [shiftOptions, setShiftOptions] = useState<ClassOption[]>([]);
  const [canAdd, setCanAdd] = useState(false);
  const [currentSession, setCurrentSession] = useState<string | null>(null);

  // Roster state, per class — the open row, its children, and the paste box.
  const [openClassId, setOpenClassId] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [paste, setPaste] = useState('');
  const [savingRoster, setSavingRoster] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [gradeCode, setGradeCode] = useState('');
  const [section, setSection] = useState('');
  const [shiftCode, setShiftCode] = useState('morning');
  const [chosenSubjects, setChosenSubjects] = useState<string[]>([]);
  const [isClassTeacher, setIsClassTeacher] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await classesApi.list();
      setItems(data.classes || []);
      setGrades(data.grades || []);
      setSubjectOptions(data.subjects || []);
      setSectionOptions(data.sections || []);
      setShiftOptions(data.shifts || []);
      setCanAdd(Boolean(data.canAdd));
      setCurrentSession(data.currentSession || null);
    } catch (error) {
      console.error('Classes fetch error:', error);
      toast({
        title: 'Could not load your classes',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setGradeCode('');
    setSection('');
    setShiftCode('morning');
    setChosenSubjects([]);
    setIsClassTeacher(false);
    setShowForm(false);
  };

  const toggleSubject = (code: string) => {
    setChosenSubjects((prev) => (
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    ));
  };

  const submit = async () => {
    if (!gradeCode) {
      toast({ title: 'Choose a class first', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await classesApi.create({
        gradeCode,
        section: section || null,
        shiftCode,
        subjectCodes: chosenSubjects,
        isClassTeacher,
      });

      if (res.success) {
        // The class was saved even when a claim was declined, so lead with that and
        // name the declined part underneath. Reading it as a failure is what sends
        // teachers back to create the class a second time.
        const declined: string[] = [];
        if (res.subjectsTaken?.length) {
          const names = res.subjectsTaken
            .map((c) => subjectOptions.find((s) => s.code === c)?.label || c)
            .join(', ');
          declined.push(`Another teacher already teaches ${names} to this class.`);
        }
        if (res.classTeacherTaken) {
          declined.push('Someone else is already the class teacher.');
        }
        toast({
          title: res.created === false ? 'That class was already there' : 'Class saved',
          description: declined.length ? declined.join(' ') : undefined,
        });
        resetForm();
        await load();
      } else {
        toast({ title: 'Could not save the class', description: res.error, variant: 'destructive' });
      }
    } catch (error: any) {
      // The API answers 409 / 422 / 503 with a sentence worth showing verbatim —
      // it says what would fix the problem, which a generic message cannot.
      const message = error?.response?.data?.error;
      toast({
        title: 'Could not save the class',
        description: message || 'Please try again in a moment.',
        variant: 'destructive',
      });
      if (error?.response?.status === 409) {
        // The class WAS created; only the class-teacher role was refused.
        await load();
        resetForm();
      }
    } finally {
      setSaving(false);
    }
  };

  const openRoster = async (classId: string) => {
    if (openClassId === classId) { setOpenClassId(null); return; }
    setOpenClassId(classId);
    setPaste('');
    setRosterLoading(true);
    try {
      const data = await classesApi.students(classId);
      setRoster(data.students || []);
    } catch (error) {
      console.error('Roster fetch error:', error);
      toast({ title: 'Could not load the students', variant: 'destructive' });
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  };

  const submitPaste = async (classId: string) => {
    if (!paste.trim()) {
      toast({ title: 'Add at least one name, one per line', variant: 'destructive' });
      return;
    }
    setSavingRoster(true);
    try {
      const res = await classesApi.addStudents(classId, paste);
      if (res.success) {
        // Duplicates and a hit cap are NOT failures, but she has to be told —
        // otherwise the count silently disagrees with what she pasted.
        const notes: string[] = [];
        if (res.duplicates) notes.push(`${res.duplicates} already on the roster`);
        if (res.dropped) notes.push(`${res.dropped} over the ${300} limit were not added`);
        toast({
          title: `${res.added} student${res.added === 1 ? '' : 's'} added`,
          description: notes.length ? notes.join(' · ') : undefined,
        });
        setPaste('');
        const data = await classesApi.students(classId);
        setRoster(data.students || []);
        await load();
      } else {
        toast({ title: 'Could not add the students', description: res.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({
        title: 'Could not add the students',
        description: error?.response?.data?.error || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSavingRoster(false);
    }
  };

  const dropStudent = async (classId: string, student: RosterStudent) => {
    // Shared roster: say so plainly, because this affects every teacher on the class.
    const ok = window.confirm(
      `Remove ${student.studentName} from this class? Every teacher on the class will stop seeing her, and her attendance record is kept.`,
    );
    if (!ok) return;
    try {
      await classesApi.removeStudent(classId, student.studentId);
      setRoster((prev) => prev.filter((s) => s.studentId !== student.studentId));
      toast({ title: `${student.studentName} removed` });
    } catch (error: any) {
      toast({
        title: 'Could not remove the student',
        description: error?.response?.data?.error || 'Please try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">My classes</h1>
            {currentSession && (
              <p className="text-sm text-muted-foreground">Session {currentSession}</p>
            )}
          </div>
          {canAdd && !showForm && (
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add a class
            </Button>
          )}
        </div>

        {!canAdd && !loading && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            We do not know which school you are at yet, so a class cannot be added.
            Ask your coach to link your school, then reload this page.
          </div>
        )}

        {showForm && (
          <div className="rounded-lg border border-border p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="class-grade">Class</label>
              <select
                id="class-grade"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={gradeCode}
                onChange={(e) => setGradeCode(e.target.value)}
              >
                <option value="">Choose…</option>
                {grades.map((g) => (
                  <option key={g.code} value={g.code}>{g.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="class-section">Section</label>
              <select
                id="class-section"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="">No section</option>
                {sectionOptions.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
              {/* A closed set, so the escape hatch has to be named — otherwise a
                  teacher whose section is missing has nowhere to go. */}
              <p className="text-xs text-muted-foreground mt-1">
                Only if your school splits this class into sections. Not listed? Ask NIETE support to add it.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="class-shift">Shift</label>
              <select
                id="class-shift"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={shiftCode}
                onChange={(e) => setShiftCode(e.target.value)}
              >
                {shiftOptions.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Morning and evening are different classes, with their own students and teachers.
              </p>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium mb-1">Subjects you teach</legend>
              <div className="flex flex-wrap gap-2">
                {subjectOptions.map((s) => {
                  const active = chosenSubjects.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSubject(s.code)}
                      className={
                        'rounded-full border px-3 py-1 text-sm transition-colors '
                        + (active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-muted-foreground hover:border-accent/60')
                      }
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isClassTeacher}
                onChange={(e) => setIsClassTeacher(e.target.checked)}
              />
              I am the class teacher
            </label>

            <div className="flex gap-2">
              <Button onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : 'Save class'}
              </Button>
              <Button variant="ghost" onClick={resetForm} disabled={saving}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState
            icon={School}
            title="No classes yet"
            description="Add the classes you teach so attendance, quizzes and lesson plans know who they are for."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((c) => (
              <li key={c.classId} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.display}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.sessionCode}
                      {c.subjects.length > 0 && ` · ${c.subjects.map((s) => s.label).join(', ')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.isClassTeacher && (
                      <span className="flex items-center gap-1 text-xs text-accent whitespace-nowrap">
                        <UserCheck className="w-3.5 h-3.5" />
                        Class teacher
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={openClassId === c.classId}
                      onClick={() => openRoster(c.classId)}
                    >
                      {openClassId === c.classId
                        ? <ChevronDown className="w-4 h-4 mr-1" />
                        : <ChevronRight className="w-4 h-4 mr-1" />}
                      <Users className="w-4 h-4 mr-1" />
                      Students
                    </Button>
                  </div>
                </div>

                {openClassId === c.classId && (
                  <div className="mt-4 border-t border-border pt-4 space-y-3">
                    {rosterLoading ? (
                      <p className="text-sm text-muted-foreground">Loading students…</p>
                    ) : roster.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No students yet. Paste the register below — one name per line.
                      </p>
                    ) : (
                      <ol className="space-y-1">
                        {roster.map((s) => (
                          <li key={s.studentId} className="flex items-center justify-between gap-3 text-sm">
                            <span>
                              <span className="text-muted-foreground tabular-nums mr-2">
                                {s.rollNumber ?? '–'}
                              </span>
                              {s.studentName}
                              {s.fatherName && (
                                <span className="text-muted-foreground"> · {s.fatherName}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${s.studentName}`}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => dropStudent(c.classId, s)}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor={`paste-${c.classId}`}>
                        Add students
                      </label>
                      <textarea
                        id={`paste-${c.classId}`}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={4}
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                        placeholder={'Ayesha Bibi, Muhammad Aslam\nBilal Ahmed s/o Tariq Mahmood'}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        One per line. Father's name after a comma or "s/o" if you have it.
                        Numbering is fine — it gets stripped.
                      </p>
                      <div className="mt-2">
                        <Button size="sm" onClick={() => submitPaste(c.classId)} disabled={savingRoster}>
                          {savingRoster ? 'Adding…' : 'Add to class'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalClasses;
