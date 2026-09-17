import { Button, Card } from './ui';
import type { SelfRating as Rating } from '../lib/db';

/** Step 3 of the trial flow: the user commits before the score is revealed. */
export function SelfRating({ onRate }: { onRate: (rating: Rating) => void }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-100">How did that one feel?</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your call first — the score stays hidden until you have committed to one.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button variant="secondary" onClick={() => onRate('good')}>
          Good
        </Button>
        <Button variant="secondary" onClick={() => onRate('unsure')}>
          Not sure
        </Button>
        <Button variant="secondary" onClick={() => onRate('off')}>
          Off
        </Button>
      </div>
    </Card>
  );
}
