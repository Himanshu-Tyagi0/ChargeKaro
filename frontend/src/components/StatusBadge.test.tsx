import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders accessible text labels alongside status icons (not color alone)', () => {
    const { rerender } = render(<StatusBadge status="FREE" />);
    expect(screen.getByText('Free')).toBeInTheDocument();

    rerender(<StatusBadge status="OCCUPIED" />);
    expect(screen.getByText('Occupied')).toBeInTheDocument();

    rerender(<StatusBadge status="BOOKED" />);
    expect(screen.getByText('Booked')).toBeInTheDocument();

    rerender(<StatusBadge status="OFFLINE" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
