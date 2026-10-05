import { useEffect, useState } from 'react';
import { Download, KeyRound, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { portal, type EditVersion } from '../../services/api';

type Props = { paperId: string; open: boolean; onOpenChange: (open: boolean) => void; onEdit: (paperId: string) => void };

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const AssessmentVersionsDialog = ({ paperId, open, onOpenChange, onEdit }: Props) => {
  const { toast } = useToast();
  const [versions, setVersions] = useState<EditVersion[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVersions(null);
    portal.getAssessmentVersions(paperId)
      .then((r) => { if (!cancelled) setVersions(r.versions); })
      .catch(() => { if (!cancelled) { setVersions([]); toast({ title: 'Could not load the versions', variant: 'destructive' }); } });
    return () => { cancelled = true; };
  }, [open, paperId, toast]);

  const download = async (id: string, artifact: 'paper' | 'answer_key') => {
    try {
      const r = await portal.getAssessmentDownload(id, artifact);
      if (r.available && r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
      else toast({ title: 'Not available', variant: 'destructive' });
    } catch { toast({ title: 'Could not open this paper', variant: 'destructive' }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Versions</DialogTitle></DialogHeader>
        {versions === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <ul className="divide-y">
            {versions.map((v) => (
              <li key={v.paperId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm">
                  {v.status === 'ready' ? (
                    <>
                      <div className="font-medium">
                        Version {v.version}{v.version === 1 ? ' · as generated' : ''}{v.latest ? ' · latest' : ''}
                      </div>
                      <div className="text-muted-foreground">{day(v.createdAt)} · {v.questionCount} questions · {v.marks} marks</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">{day(v.createdAt)} · {v.status === 'failed' ? 'Not made' : 'Being made…'}</div>
                  )}
                </div>
                {v.status === 'ready' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => download(v.paperId, 'paper')}><Download className="mr-1 h-4 w-4" />Download</Button>
                    <Button size="sm" variant="ghost" onClick={() => download(v.paperId, 'answer_key')}><KeyRound className="mr-1 h-4 w-4" />Answer key</Button>
                    <Button size="sm" onClick={() => onEdit(v.paperId)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AssessmentVersionsDialog;
