import { AppLoadingState } from '@/components/app/AppLoadingState';

export default function AppLoading() {
  return <div className="app-content-frame"><AppLoadingState label="Opening market workspace" variant="page" /></div>;
}
