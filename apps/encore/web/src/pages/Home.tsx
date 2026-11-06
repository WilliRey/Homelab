// Home is the subscription feed (Phase 5). Until then: the Continue card and a pointer to Search.
import { Link } from 'react-router-dom';
import { Empty, PageHeader } from '../components/Common';
import { Logo } from '../components/Logo';
import { ContinueCard } from '../components/ContinueCard';

export function Home() {
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-accent"><Logo size={24} /></span> Encore
          </span>
        }
      />
      <ContinueCard />
      <Empty title="Your subscriptions feed will show up here">
        <Link to="/search" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-raised px-5 text-fg">
          Search for something to play
        </Link>
      </Empty>
    </div>
  );
}
