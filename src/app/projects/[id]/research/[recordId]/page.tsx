'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import SectionHeader from '@/components/ui/SectionHeader';

export default function ProspectDetailClient({ params }: { params: Promise<{ id: string, recordId: string }> }) {
  const { id, recordId } = use(params);
  const [entry, setEntry] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/projects/${id}/research/${recordId}`);
        if (res.ok) {
          const data = await res.json();
          setEntry(data.entry);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, recordId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="py-10 text-center">
        <h2 className="text-xl text-white/80">Research Record not found</h2>
        <Link href={`/projects/${id}`} className="text-blue-400 mt-4 inline-block hover:underline">
          &larr; Back to Research
        </Link>
      </div>
    );
  }

  const { record, seed, searches, model, research_provider } = entry;
  const { 
    identity, summary, contacts, background, projects_or_work, 
    achievements, industry_involvement, evidence, sources, unknowns, confidence 
  } = record;
  
  const name = identity?.name || seed?.name || 'Unknown';
  
  // Best Contact Route
  const bestContact = contacts && contacts.length > 0 ? (
    contacts.find((c: any) => c.kind === 'email') || 
    contacts.find((c: any) => c.kind === 'linkedin') || 
    contacts[0]
  ) : null;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      
      {/* SECTION 6: Add a Back Navigation */}
      <div>
        <Link 
          href={`/projects/${id}`} 
          className="inline-flex items-center text-sm font-medium text-white/50 hover:text-white transition-colors"
        >
          &larr; Back to Research
        </Link>
      </div>

      {/* SECTION 1: Person / Organisation */}
      <GlassCard padding="p-8">
        <h1 className="text-3xl font-semibold text-white/90">{name}</h1>
        <div className="text-white/60 mt-2 text-lg">
          {identity?.role && <span className="mr-2">{identity.role}</span>}
          {identity?.organisation && <span className="mr-2">at {identity.organisation}</span>}
          {identity?.location && <span className="opacity-60 text-sm block mt-1">{identity.location}</span>}
        </div>
        
        <div className="flex flex-wrap gap-4 mt-6">
          {identity?.website && (
            <a href={identity.website} target="_blank" rel="noreferrer" className="text-sm bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1.5 rounded-lg text-white/70 transition-colors">
              Website &#8599;
            </a>
          )}
          {identity?.linkedin && (
            <a href={identity.linkedin} target="_blank" rel="noreferrer" className="text-sm bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg transition-colors">
              LinkedIn &#8599;
            </a>
          )}
          {identity?.other_public_profiles?.map((profile: string, i: number) => (
            <a key={i} href={profile} target="_blank" rel="noreferrer" className="text-sm bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1.5 rounded-lg text-white/70 transition-colors">
              Profile &#8599;
            </a>
          ))}
        </div>
      </GlassCard>

      {/* SECTION 2: Who They Are */}
      {summary && (
        <section>
          <SectionHeader title="Who They Are" className="mb-4" />
          <GlassCard padding="p-6">
            <p className="text-white/80 leading-relaxed">{summary}</p>
          </GlassCard>
        </section>
      )}

      {/* SECTION 3: Professional Background */}
      {(background && background.length > 0) && (
        <section>
          <SectionHeader title="Professional Background" className="mb-4" />
          <div className="space-y-3">
            {background.map((item: string, i: number) => (
              <GlassCard key={i} padding="p-5">
                <p className="text-white/80 text-sm leading-relaxed">{item}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 4: Work & Projects */}
      {(projects_or_work && projects_or_work.length > 0) && (
        <section>
          <SectionHeader title="Books, Projects & Work" className="mb-4" />
          <div className="space-y-3">
            {projects_or_work.map((item: string, i: number) => (
              <GlassCard key={i} padding="p-5">
                <p className="text-white/80 text-sm leading-relaxed">{item}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 5: Achievements */}
      {(achievements && achievements.length > 0) && (
        <section>
          <SectionHeader title="Achievements" className="mb-4" />
          <div className="space-y-3">
            {achievements.map((item: string, i: number) => (
              <GlassCard key={i} padding="p-5">
                <p className="text-white/80 text-sm leading-relaxed">{item}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 6: Industry Involvement */}
      {(industry_involvement && industry_involvement.length > 0) && (
        <section>
          <SectionHeader title="Industry Involvement" className="mb-4" />
          <div className="space-y-3">
            {industry_involvement.map((item: string, i: number) => (
              <GlassCard key={i} padding="p-5">
                <p className="text-white/80 text-sm leading-relaxed">{item}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 7 & 8: Contact Information & Recommended Contact Route */}
      {(contacts && contacts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section>
            <SectionHeader title="Contact Information" className="mb-4" />
            <div className="space-y-3">
              {contacts.map((c: any, i: number) => (
                <GlassCard key={i} padding="p-4" className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-1">{c.kind}</div>
                    <div className="text-white/90 font-medium">
                      {c.value.includes('http') || c.value.includes('@') ? (
                        <a href={c.value.includes('@') && !c.value.startsWith('mailto:') ? `mailto:${c.value}` : c.value} target="_blank" rel="noreferrer" className="hover:underline text-blue-400">
                          {c.value}
                        </a>
                      ) : (
                        c.value
                      )}
                    </div>
                  </div>
                  {c.confidence && (
                    <div className="text-xs px-2 py-1 bg-white/[0.05] rounded-md text-white/50 border border-white/[0.05]">
                      {c.confidence === 'high' ? 'Verified' : c.confidence === 'medium' ? 'Public contact' : 'Low confidence'}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </section>

          {bestContact && (
            <section>
              <SectionHeader title="Recommended Contact Route" className="mb-4" />
              <GlassCard padding="p-6" className="h-[calc(100%-3rem)] bg-white/[0.04]">
                <div className="text-sm text-white/40 uppercase tracking-wider font-semibold mb-2">
                  {bestContact.kind}
                </div>
                <div className="text-xl text-white/90 font-medium mb-3 break-all">
                  {bestContact.value}
                </div>
                <p className="text-sm text-white/60">
                  {bestContact.kind === 'email' ? 'Official contact route listed for external communication.' : 
                   bestContact.kind === 'linkedin' ? 'Most appropriate public professional route identified.' : 
                   'Publicly available professional profile.'}
                </p>
              </GlassCard>
            </section>
          )}
        </div>
      )}

      {/* SECTION 9: Evidence */}
      {(evidence && evidence.length > 0) && (
        <section>
          <SectionHeader title="Evidence" className="mb-4" />
          <div className="space-y-3">
            {evidence.map((ev: any, i: number) => {
              // Find the primary source URL if available
              const sourceIds = ev.source_ids || [];
              const relevantSources = sources?.filter((s: any) => sourceIds.includes(s.id)) || [];
              const mainSource = relevantSources[0];

              return (
                <details key={i} className="group bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden cursor-pointer">
                  <summary className="p-4 text-sm text-white/80 font-medium flex items-center justify-between outline-none">
                    <span className="pr-4">{ev.claim}</span>
                    <span className="text-xs text-white/40 whitespace-nowrap bg-white/[0.05] px-2 py-1 rounded">View Evidence &darr;</span>
                  </summary>
                  <div className="p-4 pt-0 border-t border-white/[0.06] mt-2">
                    <div className="bg-black/20 p-4 rounded-lg mt-3 text-sm text-white/60">
                      {ev.quote ? (
                        <blockquote className="italic border-l-2 border-white/20 pl-3 py-1 mb-3">"{ev.quote}"</blockquote>
                      ) : (
                        <p className="mb-3">No direct quote provided.</p>
                      )}
                      
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="bg-white/10 px-2 py-1 rounded">Confidence: {ev.confidence || 'unknown'}</span>
                        
                        {relevantSources.map((s: any, idx: number) => (
                          <span key={idx} className="flex items-center gap-1.5">
                            Source {s.id}: 
                            <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center truncate max-w-[200px]">
                              {s.title || new URL(s.url).hostname} <span className="ml-1 text-[10px]">&#8599;</span>
                            </a>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {/* SECTION 10: Unknown / Could Not Verify */}
      {(unknowns && unknowns.length > 0) && (
        <section>
          <SectionHeader title="Information We Couldn't Verify" className="mb-4" />
          <div className="space-y-3">
            {unknowns.map((unk: any, i: number) => (
              <GlassCard key={i} padding="p-4" className="border-l-2 border-l-amber-500/50">
                <p className="text-sm text-white/80">
                  <span className="font-semibold text-white/90 mr-2">{unk.field}:</span>
                  {unk.reason}
                </p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 11: Research Confidence & Metadata */}
      <div className="flex flex-wrap items-center gap-4 mt-12 pt-8 border-t border-white/[0.05] text-xs text-white/40">
        <div>
          Research confidence:{' '}
          <span className={`font-medium ${confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>
            {confidence ? confidence.charAt(0).toUpperCase() + confidence.slice(1) : 'Unknown'}
          </span>
        </div>
        <div>&bull;</div>
        <div>Research completed: {new Date(entry.record.researched_at || Date.now()).toLocaleDateString()}</div>
        <div>&bull;</div>
        <div>Sources checked: {sources?.length || searches?.length || 0}</div>
        {research_provider && (
          <>
            <div>&bull;</div>
            <div>Search Agent: {research_provider}</div>
          </>
        )}
      </div>
      
    </div>
  );
}
