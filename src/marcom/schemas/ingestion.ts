export type SourceType = 'text' | 'pdf' | 'docx' | 'txt' | 'md' | 'google_doc';

export interface BriefSource {
  id: string;
  source_type: SourceType;
  source_name: string;
  source_url?: string;
  mime_type?: string;
  file_size?: number;
  extracted_text: string;
  extraction_status: 'pending' | 'success' | 'error';
  error_message?: string;
  created_at: string;
}

export interface NormalizedProjectBrief {
  source_id: string;
  cleaned_text: string;
  project_name_hint?: string;
  metadata?: Record<string, unknown>;
}
