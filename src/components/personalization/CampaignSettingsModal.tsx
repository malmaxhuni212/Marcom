'use client';

import { useState } from 'react';
import type { PersonalizationSettings } from '@/marcom/schemas/personalization';
import { authenticatedFetch } from '@/auth/client';

interface CampaignSettingsModalProps {
  projectId: string;
  initialSettings: PersonalizationSettings;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (settings: PersonalizationSettings) => void;
}

export default function CampaignSettingsModal({
  projectId,
  initialSettings,
  isOpen,
  onClose,
  onSaved,
}: CampaignSettingsModalProps) {
  const [senderName, setSenderName] = useState(initialSettings.sender_name || '');
  const [senderRole, setSenderRole] = useState(initialSettings.sender_role || '');
  const [organisation, setOrganisation] = useState(initialSettings.organisation || '');
  const [facts, setFacts] = useState<string[]>(initialSettings.campaign_facts || []);
  const [ctaLink, setCtaLink] = useState(initialSettings.call_to_action_link || '');
  const [signature, setSignature] = useState(initialSettings.signature || '');
  const [extraGuidance, setExtraGuidance] = useState(initialSettings.extra_guidance || '');
  const [newFact, setNewFact] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddFact = () => {
    if (!newFact.trim()) return;
    setFacts([...facts, newFact.trim()]);
    setNewFact('');
  };

  const handleRemoveFact = (index: number) => {
    setFacts(facts.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        sender_name: senderName.trim(),
        sender_role: senderRole.trim(),
        organisation: organisation.trim(),
        campaign_facts: facts,
        call_to_action_link: ctaLink.trim() || null,
        signature: signature.trim() || null,
        extra_guidance: extraGuidance.trim(),
      };

      const res = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings.');
      onSaved(data.settings);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0d0d14] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-white/90">Campaign Outreach Settings</h3>
            <p className="text-xs text-white/40">These settings guide Model 1 and Model 2 for this campaign.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200">{error}</div>}

          {/* Sender details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Sender Name</label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="e.g. Maya Editorial Team"
                className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-white/85 outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Sender Role / Title</label>
              <input
                type="text"
                value={senderRole}
                onChange={(e) => setSenderRole(e.target.value)}
                placeholder="e.g. Submissions Coordinator"
                className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-white/85 outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Organisation / Project</label>
            <input
              type="text"
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              placeholder="e.g. Maya Book Awards"
              className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-white/85 outline-none focus:border-cyan-400"
            />
          </div>

          {/* Campaign Facts */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Verified Campaign Facts (Only these may be claimed in outreach)
            </label>
            <div className="mt-2 space-y-1.5">
              {facts.map((fact, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <span className="text-white/80 leading-relaxed">• {fact}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFact(idx)}
                    className="text-white/30 hover:text-rose-400 shrink-0 px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddFact())}
                placeholder="Add a verified fact (e.g. 'Submissions open until Dec 15th')..."
                className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-white/85 outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={handleAddFact}
                className="rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-white/80 hover:bg-white/[0.1]"
              >
                Add Fact
              </button>
            </div>
          </div>

          {/* CTA Link */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Call to Action Link</label>
            <input
              type="text"
              value={ctaLink}
              onChange={(e) => setCtaLink(e.target.value)}
              placeholder="e.g. https://mayabookawards.com/guidelines"
              className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-white/85 outline-none focus:border-cyan-400"
            />
          </div>

          {/* Email Signature */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Email Signature</label>
            <textarea
              rows={3}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="e.g. Warm regards,&#10;Maya Editorial Team&#10;submissions@mayabookawards.com"
              className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-white/85 font-mono outline-none focus:border-cyan-400"
            />
          </div>

          {/* Extra Guidance */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Extra Style Guidance</label>
            <textarea
              rows={2}
              value={extraGuidance}
              onChange={(e) => setExtraGuidance(e.target.value)}
              placeholder="e.g. Professional, warm, respectful. Never pressure. Cite their actual books or literary achievements."
              className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-white/85 outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.07] px-6 py-4 bg-white/[0.01]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-white/60 hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Campaign Settings'}
          </button>
        </footer>
      </div>
    </div>
  );
}
