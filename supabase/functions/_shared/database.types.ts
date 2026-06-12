export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_observations: {
        Row: {
          acted_result: Json | null
          action_kind: string | null
          action_payload: Json | null
          actioned_at: string | null
          created_at: string
          dedup_key: string | null
          detail: string | null
          dismissed_at: string | null
          id: string
          kind: string
          org_id: string
          project_id: string | null
          proposed_action: string | null
          severity: string
          status: string
          surface_until: string | null
          title: string
        }
        Insert: {
          acted_result?: Json | null
          action_kind?: string | null
          action_payload?: Json | null
          actioned_at?: string | null
          created_at?: string
          dedup_key?: string | null
          detail?: string | null
          dismissed_at?: string | null
          id?: string
          kind: string
          org_id: string
          project_id?: string | null
          proposed_action?: string | null
          severity: string
          status?: string
          surface_until?: string | null
          title: string
        }
        Update: {
          acted_result?: Json | null
          action_kind?: string | null
          action_payload?: Json | null
          actioned_at?: string | null
          created_at?: string
          dedup_key?: string | null
          detail?: string | null
          dismissed_at?: string | null
          id?: string
          kind?: string
          org_id?: string
          project_id?: string | null
          proposed_action?: string | null
          severity?: string
          status?: string
          surface_until?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_observations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_observations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audiences: {
        Row: {
          attributes: Json
          created_at: string
          goals: Json
          id: string
          is_primary: boolean
          kind: string
          name: string
          notes: string | null
          org_id: string
          pain_points: Json
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          attributes?: Json
          created_at?: string
          goals?: Json
          id?: string
          is_primary?: boolean
          kind: string
          name: string
          notes?: string | null
          org_id: string
          pain_points?: Json
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          attributes?: Json
          created_at?: string
          goals?: Json
          id?: string
          is_primary?: boolean
          kind?: string
          name?: string
          notes?: string | null
          org_id?: string
          pain_points?: Json
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audiences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audiences_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "audiences"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          applied_at: string | null
          channels_audited: Json
          created_at: string
          error_message: string | null
          id: string
          org_id: string
          proposed_brand_voice: Json | null
          proposed_personas: Json | null
          proposed_skills: Json | null
          raw_findings: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          channels_audited?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          org_id: string
          proposed_brand_voice?: Json | null
          proposed_personas?: Json | null
          proposed_skills?: Json | null
          raw_findings?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          channels_audited?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          org_id?: string
          proposed_brand_voice?: Json | null
          proposed_personas?: Json | null
          proposed_skills?: Json | null
          raw_findings?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_voice: {
        Row: {
          created_at: string
          forbidden_phrases: string[] | null
          id: string
          org_id: string
          persona_descriptor: string | null
          persona_gender: string | null
          persona_name: string | null
          project_id: string | null
          required_phrases: string[] | null
          sample_posts: string[] | null
          system_prompt: string | null
          tone: string[] | null
          updated_at: string
          writing_rules: string[] | null
        }
        Insert: {
          created_at?: string
          forbidden_phrases?: string[] | null
          id?: string
          org_id: string
          persona_descriptor?: string | null
          persona_gender?: string | null
          persona_name?: string | null
          project_id?: string | null
          required_phrases?: string[] | null
          sample_posts?: string[] | null
          system_prompt?: string | null
          tone?: string[] | null
          updated_at?: string
          writing_rules?: string[] | null
        }
        Update: {
          created_at?: string
          forbidden_phrases?: string[] | null
          id?: string
          org_id?: string
          persona_descriptor?: string | null
          persona_gender?: string | null
          persona_name?: string | null
          project_id?: string | null
          required_phrases?: string[] | null
          sample_posts?: string[] | null
          system_prompt?: string | null
          tone?: string[] | null
          updated_at?: string
          writing_rules?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_voice_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_voice_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          color: string
          created_at: string
          description: string | null
          end_date: string | null
          goal: string | null
          id: string
          is_pinned: boolean
          name: string
          org_id: string
          platforms: string[] | null
          post_count: number
          project_id: string | null
          start_date: string | null
          status: string
          theme: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          is_pinned?: boolean
          name: string
          org_id: string
          platforms?: string[] | null
          post_count?: number
          project_id?: string | null
          start_date?: string | null
          status?: string
          theme?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          is_pinned?: boolean
          name?: string
          org_id?: string
          platforms?: string[] | null
          post_count?: number
          project_id?: string | null
          start_date?: string | null
          status?: string
          theme?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_profiles: {
        Row: {
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          id: string
          is_active: boolean
          last_audited_at: string | null
          org_id: string
          updated_at: string
          url: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          id?: string
          is_active?: boolean
          last_audited_at?: string | null
          org_id: string
          updated_at?: string
          url: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          id?: string
          is_active?: boolean
          last_audited_at?: string | null
          org_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json
          content: string
          created_at: string
          id: string
          org_id: string
          project_id: string | null
          role: string
          route: string | null
          session_id: string | null
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
        }
        Insert: {
          attachments?: Json
          content: string
          created_at?: string
          id?: string
          org_id: string
          project_id?: string | null
          role: string
          route?: string | null
          session_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Update: {
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string | null
          role?: string
          route?: string | null
          session_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_user_entitlements: {
        Row: {
          capability: string
          created_at: string
          enabled: boolean
          expires_at: string | null
          granted_by: string | null
          id: string
          note: string | null
          org_id: string | null
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capability: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          org_id?: string | null
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capability?: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          org_id?: string | null
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_user_entitlements_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_user_entitlements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_user_entitlements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_user_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_api_keys: {
        Row: {
          capabilities: Json
          config: Json
          created_at: string
          created_by: string | null
          id: string
          label: string
          last_tested_at: string | null
          last_used_at: string | null
          models: Json
          org_id: string
          project_id: string
          provider: string
          secret_ciphertext: string | null
          secret_preview: string | null
          status: string
          test_error: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capabilities?: Json
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          last_tested_at?: string | null
          last_used_at?: string | null
          models?: Json
          org_id: string
          project_id: string
          provider: string
          secret_ciphertext?: string | null
          secret_preview?: string | null
          status?: string
          test_error?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capabilities?: Json
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_tested_at?: string | null
          last_used_at?: string | null
          models?: Json
          org_id?: string
          project_id?: string
          provider?: string
          secret_ciphertext?: string | null
          secret_preview?: string | null
          status?: string
          test_error?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_api_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_integrations: {
        Row: {
          capabilities: Json
          category: string
          config: Json
          connection_kind: string
          created_at: string
          created_by: string | null
          credential_ref: string | null
          display_name: string
          external_ref: Json
          health_detail: string | null
          health_status: string
          id: string
          last_health_check: string | null
          last_sync_at: string | null
          org_id: string
          project_id: string
          provider: string
          scopes: string[]
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capabilities?: Json
          category: string
          config?: Json
          connection_kind?: string
          created_at?: string
          created_by?: string | null
          credential_ref?: string | null
          display_name: string
          external_ref?: Json
          health_detail?: string | null
          health_status?: string
          id?: string
          last_health_check?: string | null
          last_sync_at?: string | null
          org_id: string
          project_id: string
          provider: string
          scopes?: string[]
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capabilities?: Json
          category?: string
          config?: Json
          connection_kind?: string
          created_at?: string
          created_by?: string | null
          credential_ref?: string | null
          display_name?: string
          external_ref?: Json
          health_detail?: string | null
          health_status?: string
          id?: string
          last_health_check?: string | null
          last_sync_at?: string | null
          org_id?: string
          project_id?: string
          provider?: string
          scopes?: string[]
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_integrations_credential_ref_fkey"
            columns: ["credential_ref"]
            isOneToOne: false
            referencedRelation: "client_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_events: {
        Row: {
          briefed_at: string | null
          competitor_id: string
          detected_at: string
          id: string
          kind: string
          meta: Json | null
          org_id: string
          read_at: string | null
          source_url: string
          summary: string | null
          title: string | null
        }
        Insert: {
          briefed_at?: string | null
          competitor_id: string
          detected_at?: string
          id?: string
          kind: string
          meta?: Json | null
          org_id: string
          read_at?: string | null
          source_url: string
          summary?: string | null
          title?: string | null
        }
        Update: {
          briefed_at?: string | null
          competitor_id?: string
          detected_at?: string
          id?: string
          kind?: string
          meta?: Json | null
          org_id?: string
          read_at?: string | null
          source_url?: string
          summary?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_events_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_snapshots: {
        Row: {
          competitor_id: string
          id: string
          kind: string
          payload: Json
          taken_at: string
        }
        Insert: {
          competitor_id: string
          id?: string
          kind: string
          payload: Json
          taken_at?: string
        }
        Update: {
          competitor_id?: string
          id?: string
          kind?: string
          payload?: Json
          taken_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_snapshots_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          org_id: string
          rss_url: string | null
          twitter_handle: string | null
          updated_at: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          org_id: string
          rss_url?: string | null
          twitter_handle?: string | null
          updated_at?: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          org_id?: string
          rss_url?: string | null
          twitter_handle?: string | null
          updated_at?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_briefs: {
        Row: {
          angle: string | null
          campaign_id: string | null
          content_type: string
          created_at: string
          cta: string | null
          id: string
          key_messages: string[] | null
          model_preference: string | null
          objective: string
          org_id: string
          persona_id: string | null
          platform: string
          title: string | null
          updated_at: string
        }
        Insert: {
          angle?: string | null
          campaign_id?: string | null
          content_type: string
          created_at?: string
          cta?: string | null
          id?: string
          key_messages?: string[] | null
          model_preference?: string | null
          objective: string
          org_id: string
          persona_id?: string | null
          platform: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          angle?: string | null
          campaign_id?: string | null
          content_type?: string
          created_at?: string
          cta?: string | null
          id?: string
          key_messages?: string[] | null
          model_preference?: string | null
          objective?: string
          org_id?: string
          persona_id?: string | null
          platform?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_briefs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_briefs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_briefs_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      content_categories: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          org_id: string | null
          project_id: string | null
          sort_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          org_id?: string | null
          project_id?: string | null
          sort_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string | null
          project_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_metric_snapshots: {
        Row: {
          created_at: string
          id: string
          metric_name: string
          metric_period: string
          metric_time: string | null
          metric_value: number
          object_type: string
          org_id: string
          post_id: string | null
          project_id: string
          provider: string
          provider_account_id: string | null
          provider_object_id: string | null
          pulled_at: string
          raw: Json
        }
        Insert: {
          created_at?: string
          id?: string
          metric_name: string
          metric_period?: string
          metric_time?: string | null
          metric_value?: number
          object_type?: string
          org_id: string
          post_id?: string | null
          project_id: string
          provider: string
          provider_account_id?: string | null
          provider_object_id?: string | null
          pulled_at?: string
          raw?: Json
        }
        Update: {
          created_at?: string
          id?: string
          metric_name?: string
          metric_period?: string
          metric_time?: string | null
          metric_value?: number
          object_type?: string
          org_id?: string
          post_id?: string | null
          project_id?: string
          provider?: string
          provider_account_id?: string | null
          provider_object_id?: string | null
          pulled_at?: string
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "content_metric_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_metric_snapshots_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_metric_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_post_publish_claims: {
        Row: {
          channel: string
          claim_status: string
          claimed_by: string
          completed_at: string | null
          last_error: string | null
          locked_at: string
          org_id: string | null
          post_id: string
          project_id: string | null
          remote_id: string | null
          remote_url: string | null
          updated_at: string
        }
        Insert: {
          channel: string
          claim_status?: string
          claimed_by?: string
          completed_at?: string | null
          last_error?: string | null
          locked_at?: string
          org_id?: string | null
          post_id: string
          project_id?: string | null
          remote_id?: string | null
          remote_url?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          claim_status?: string
          claimed_by?: string
          completed_at?: string | null
          last_error?: string | null
          locked_at?: string
          org_id?: string | null
          post_id?: string
          project_id?: string | null
          remote_id?: string | null
          remote_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_post_publish_claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_post_publish_claims_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_post_publish_claims_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_posts: {
        Row: {
          agent_outputs: Json | null
          airtable_record_id: string | null
          asana_task_gid: string | null
          audience_id: string | null
          author: string | null
          brief_id: string | null
          campaign_id: string | null
          category: string | null
          channel: string
          compliance_checks: Json | null
          copy: string
          created_at: string
          created_by: string | null
          feedback: string | null
          format: string
          hashtags: string[] | null
          id: string
          last_metric_sync_at: string | null
          media_metadata: Json | null
          media_type: string | null
          media_url: string | null
          model_used: string | null
          org_id: string | null
          persona_id: string | null
          posted_at: string | null
          posted_url: string | null
          profile_name: string | null
          profile_title: string | null
          project_id: string | null
          provider: string | null
          provider_account_id: string | null
          provider_media_id: string | null
          provider_page_id: string | null
          provider_permalink: string | null
          provider_post_id: string | null
          publish_date: string | null
          published_at: string | null
          review_token: string | null
          review_token_expires_at: string | null
          review_token_revoked_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scheduled_at: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          agent_outputs?: Json | null
          airtable_record_id?: string | null
          asana_task_gid?: string | null
          audience_id?: string | null
          author?: string | null
          brief_id?: string | null
          campaign_id?: string | null
          category?: string | null
          channel?: string
          compliance_checks?: Json | null
          copy: string
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          format?: string
          hashtags?: string[] | null
          id?: string
          last_metric_sync_at?: string | null
          media_metadata?: Json | null
          media_type?: string | null
          media_url?: string | null
          model_used?: string | null
          org_id?: string | null
          persona_id?: string | null
          posted_at?: string | null
          posted_url?: string | null
          profile_name?: string | null
          profile_title?: string | null
          project_id?: string | null
          provider?: string | null
          provider_account_id?: string | null
          provider_media_id?: string | null
          provider_page_id?: string | null
          provider_permalink?: string | null
          provider_post_id?: string | null
          publish_date?: string | null
          published_at?: string | null
          review_token?: string | null
          review_token_expires_at?: string | null
          review_token_revoked_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          agent_outputs?: Json | null
          airtable_record_id?: string | null
          asana_task_gid?: string | null
          audience_id?: string | null
          author?: string | null
          brief_id?: string | null
          campaign_id?: string | null
          category?: string | null
          channel?: string
          compliance_checks?: Json | null
          copy?: string
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          format?: string
          hashtags?: string[] | null
          id?: string
          last_metric_sync_at?: string | null
          media_metadata?: Json | null
          media_type?: string | null
          media_url?: string | null
          model_used?: string | null
          org_id?: string | null
          persona_id?: string | null
          posted_at?: string | null
          posted_url?: string | null
          profile_name?: string | null
          profile_title?: string | null
          project_id?: string | null
          provider?: string | null
          provider_account_id?: string | null
          provider_media_id?: string | null
          provider_page_id?: string | null
          provider_permalink?: string | null
          provider_post_id?: string | null
          publish_date?: string | null
          published_at?: string | null
          review_token?: string | null
          review_token_expires_at?: string | null
          review_token_revoked_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_posts_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "audiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "content_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_log: {
        Row: {
          agent: string | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          id: string
          input_tokens: number | null
          model_used: string | null
          operation: string | null
          org_id: string | null
          output_tokens: number | null
          post_id: string | null
          project_id: string | null
          provider: string | null
          usage_metadata: Json
        }
        Insert: {
          agent?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model_used?: string | null
          operation?: string | null
          org_id?: string | null
          output_tokens?: number | null
          post_id?: string | null
          project_id?: string | null
          provider?: string | null
          usage_metadata?: Json
        }
        Update: {
          agent?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model_used?: string | null
          operation?: string | null
          org_id?: string | null
          output_tokens?: number | null
          post_id?: string | null
          project_id?: string | null
          provider?: string | null
          usage_metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "generation_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_log_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_article_revisions: {
        Row: {
          article_id: string | null
          changes_summary: string | null
          confidence: number | null
          created_at: string
          evidence: Json | null
          id: string
          kind: string
          org_id: string
          proposed_body: string | null
          proposed_title: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          article_id?: string | null
          changes_summary?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          kind: string
          org_id: string
          proposed_body?: string | null
          proposed_title?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          article_id?: string | null
          changes_summary?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          kind?: string
          org_id?: string
          proposed_body?: string | null
          proposed_title?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_article_revisions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_article_revisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          body: string
          created_at: string
          embedding: string | null
          id: string
          org_id: string
          slug: string
          source_ids: string[]
          status: string
          summary: string | null
          themes: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          embedding?: string | null
          id?: string
          org_id: string
          slug: string
          source_ids?: string[]
          status?: string
          summary?: string | null
          themes?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          embedding?: string | null
          id?: string
          org_id?: string
          slug?: string
          source_ids?: string[]
          status?: string
          summary?: string | null
          themes?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_change_log: {
        Row: {
          detail: Json | null
          event: string
          id: string
          org_id: string
          recorded_at: string
          ref_id: string | null
          ref_table: string | null
        }
        Insert: {
          detail?: Json | null
          event: string
          id?: string
          org_id: string
          recorded_at?: string
          ref_id?: string | null
          ref_table?: string | null
        }
        Update: {
          detail?: Json | null
          event?: string
          id?: string
          org_id?: string
          recorded_at?: string
          ref_id?: string | null
          ref_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_change_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_raw: {
        Row: {
          content: string
          embedding: string | null
          id: string
          ingested_at: string
          ingested_by: string | null
          kind: string
          metadata: Json
          org_id: string
          source: string | null
          title: string | null
        }
        Insert: {
          content: string
          embedding?: string | null
          id?: string
          ingested_at?: string
          ingested_by?: string | null
          kind: string
          metadata?: Json
          org_id: string
          source?: string | null
          title?: string | null
        }
        Update: {
          content?: string
          embedding?: string | null
          id?: string
          ingested_at?: string
          ingested_by?: string | null
          kind?: string
          metadata?: Json
          org_id?: string
          source?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_raw_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_audits: {
        Row: {
          created_at: string
          enabled_principles: string[] | null
          id: string
          kind: string
          org_id: string
          project_id: string | null
          result: Json
        }
        Insert: {
          created_at?: string
          enabled_principles?: string[] | null
          id?: string
          kind: string
          org_id: string
          project_id?: string | null
          result: Json
        }
        Update: {
          created_at?: string
          enabled_principles?: string[] | null
          id?: string
          kind?: string
          org_id?: string
          project_id?: string | null
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_audits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_audits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      media_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          kind: string
          post_id: string | null
          project_id: string | null
          result: Json | null
          session_id: string | null
          spec: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          post_id?: string | null
          project_id?: string | null
          result?: Json | null
          session_id?: string | null
          spec?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          post_id?: string | null
          project_id?: string | null
          result?: Json | null
          session_id?: string | null
          spec?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_jobs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          collected: Json
          completed_at: string | null
          current_step: number
          id: string
          org_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          collected?: Json
          completed_at?: string | null
          current_step?: number
          id?: string
          org_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          collected?: Json
          completed_at?: string | null
          current_step?: number
          id?: string
          org_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          business_model: string
          created_at: string
          email_domain: string | null
          gsc_connected_at: string | null
          gsc_property_url: string | null
          gsc_refresh_token: string | null
          id: string
          industry: string | null
          is_master: boolean
          locale: string
          logo_url: string | null
          name: string
          plan: string
          settings: Json
          slug: string
          timezone: string
          unipile_account_id: string | null
          unipile_connected_at: string | null
          unipile_health_status: string | null
          unipile_last_health_check: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          business_model?: string
          created_at?: string
          email_domain?: string | null
          gsc_connected_at?: string | null
          gsc_property_url?: string | null
          gsc_refresh_token?: string | null
          id?: string
          industry?: string | null
          is_master?: boolean
          locale?: string
          logo_url?: string | null
          name: string
          plan?: string
          settings?: Json
          slug: string
          timezone?: string
          unipile_account_id?: string | null
          unipile_connected_at?: string | null
          unipile_health_status?: string | null
          unipile_last_health_check?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          business_model?: string
          created_at?: string
          email_domain?: string | null
          gsc_connected_at?: string | null
          gsc_property_url?: string | null
          gsc_refresh_token?: string | null
          id?: string
          industry?: string | null
          is_master?: boolean
          locale?: string
          logo_url?: string | null
          name?: string
          plan?: string
          settings?: Json
          slug?: string
          timezone?: string
          unipile_account_id?: string | null
          unipile_connected_at?: string | null
          unipile_health_status?: string | null
          unipile_last_health_check?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      personas: {
        Row: {
          channels: string[] | null
          created_at: string
          goals: string[] | null
          id: string
          industry: string | null
          is_primary: boolean
          name: string
          org_id: string
          pain_points: string[] | null
          seniority: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          channels?: string[] | null
          created_at?: string
          goals?: string[] | null
          id?: string
          industry?: string | null
          is_primary?: boolean
          name: string
          org_id: string
          pain_points?: string[] | null
          seniority?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          channels?: string[] | null
          created_at?: string
          goals?: string[] | null
          id?: string
          industry?: string | null
          is_primary?: boolean
          name?: string
          org_id?: string
          pain_points?: string[] | null
          seniority?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_configs: {
        Row: {
          best_times: string[] | null
          char_limit: number | null
          content_types: string[] | null
          created_at: string
          default_hashtags: string[] | null
          hashtag_limit: number
          id: string
          is_active: boolean
          model_override: string | null
          org_id: string
          platform: string
          tone_override: string | null
          updated_at: string
        }
        Insert: {
          best_times?: string[] | null
          char_limit?: number | null
          content_types?: string[] | null
          created_at?: string
          default_hashtags?: string[] | null
          hashtag_limit?: number
          id?: string
          is_active?: boolean
          model_override?: string | null
          org_id: string
          platform: string
          tone_override?: string | null
          updated_at?: string
        }
        Update: {
          best_times?: string[] | null
          char_limit?: number | null
          content_types?: string[] | null
          created_at?: string
          default_hashtags?: string[] | null
          hashtag_limit?: number
          id?: string
          is_active?: boolean
          model_override?: string | null
          org_id?: string
          platform?: string
          tone_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_outcomes: {
        Row: {
          edit_summary: Json | null
          feedback: string | null
          id: string
          outcome: string
          post_id: string
          recorded_at: string
          recorded_by: string | null
        }
        Insert: {
          edit_summary?: Json | null
          feedback?: string | null
          id?: string
          outcome: string
          post_id: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Update: {
          edit_summary?: Json | null
          feedback?: string | null
          id?: string
          outcome?: string
          post_id?: string
          recorded_at?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_outcomes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assets: {
        Row: {
          created_at: string
          file_size: number
          id: string
          kind: string
          knowledge_id: string | null
          metadata: Json | null
          mime_type: string
          name: string
          project_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_size: number
          id?: string
          kind: string
          knowledge_id?: string | null
          metadata?: Json | null
          mime_type: string
          name: string
          project_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_size?: number
          id?: string
          kind?: string
          knowledge_id?: string | null
          metadata?: Json | null
          mime_type?: string
          name?: string
          project_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assets_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "project_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invites: {
        Row: {
          accepted_by: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          invite_token: string
          org_id: string
          project_id: string
          role: string
          send_error: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          invite_token?: string
          org_id: string
          project_id: string
          role?: string
          send_error?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          invite_token?: string
          org_id?: string
          project_id?: string
          role?: string
          send_error?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_knowledge: {
        Row: {
          classified_at: string | null
          content: string
          created_at: string
          embedding: string | null
          extracted: Json | null
          file_name: string | null
          file_size: number | null
          id: string
          kind: string | null
          project_id: string
          source_kind: string
          source_url: string | null
          suggestion: string | null
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          classified_at?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          extracted?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          kind?: string | null
          project_id: string
          source_kind: string
          source_url?: string | null
          suggestion?: string | null
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          classified_at?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          extracted?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          kind?: string | null
          project_id?: string
          source_kind?: string
          source_url?: string | null
          suggestion?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_knowledge_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          project_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          project_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          project_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          ai_policy: Json
          created_at: string
          description: string | null
          id: string
          instructions: string | null
          is_archived: boolean
          is_default: boolean
          is_starred: boolean
          name: string
          org_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          ai_policy?: Json
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          is_archived?: boolean
          is_default?: boolean
          is_starred?: boolean
          name: string
          org_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          ai_policy?: Json
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          is_archived?: boolean
          is_default?: boolean
          is_starred?: boolean
          name?: string
          org_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_attempts: {
        Row: {
          attempt_seq: number
          completed_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          latency_ms: number | null
          org_id: string
          outcome: string
          phase: string
          post_id: string | null
          publisher_id: string
          recovery_action: string | null
          remote_id: string | null
          remote_url: string | null
          request_payload: Json | null
          response_body: Json | null
          started_at: string
        }
        Insert: {
          attempt_seq?: number
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          latency_ms?: number | null
          org_id: string
          outcome: string
          phase: string
          post_id?: string | null
          publisher_id: string
          recovery_action?: string | null
          remote_id?: string | null
          remote_url?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          started_at?: string
        }
        Update: {
          attempt_seq?: number
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          latency_ms?: number | null
          org_id?: string
          outcome?: string
          phase?: string
          post_id?: string | null
          publisher_id?: string
          recovery_action?: string | null
          remote_id?: string | null
          remote_url?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_attempts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_attempts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_attempts_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_locks: {
        Row: {
          expires_at: string
          locked_at: string
          locked_by: string | null
          post_id: string
          publisher_id: string
        }
        Insert: {
          expires_at?: string
          locked_at?: string
          locked_by?: string | null
          post_id: string
          publisher_id: string
        }
        Update: {
          expires_at?: string
          locked_at?: string
          locked_by?: string | null
          post_id?: string
          publisher_id?: string
        }
        Relationships: []
      }
      publishers: {
        Row: {
          config: Json
          connected_at: string
          connected_by: string | null
          credentials_ref: string
          default_status: string
          health_detail: string | null
          health_status: string | null
          id: string
          kind: string
          last_health_check: string | null
          name: string
          org_id: string
        }
        Insert: {
          config?: Json
          connected_at?: string
          connected_by?: string | null
          credentials_ref: string
          default_status?: string
          health_detail?: string | null
          health_status?: string | null
          id?: string
          kind: string
          last_health_check?: string | null
          name: string
          org_id: string
        }
        Update: {
          config?: Json
          connected_at?: string
          connected_by?: string | null
          credentials_ref?: string
          default_status?: string
          health_detail?: string | null
          health_status?: string | null
          id?: string
          kind?: string
          last_health_check?: string | null
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_audits: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          org_id: string
          page_speed: Json | null
          pages_audited: string[] | null
          result: Json
          status: string
          website_url: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          org_id: string
          page_speed?: Json | null
          pages_audited?: string[] | null
          result: Json
          status?: string
          website_url: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          org_id?: string
          page_speed?: Json | null
          pages_audited?: string[] | null
          result?: Json
          status?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_audits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_invocations: {
        Row: {
          applied_at: string
          applied_by: string | null
          applied_in: string
          id: string
          org_id: string | null
          post_id: string | null
          skill_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          applied_in: string
          id?: string
          org_id?: string | null
          post_id?: string | null
          skill_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          applied_in?: string
          id?: string
          org_id?: string | null
          post_id?: string | null
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_invocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_invocations_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_invocations_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skill_performance"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_invocations_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_revisions: {
        Row: {
          changes_summary: string | null
          confidence: number | null
          created_at: string
          current_module: string
          evidence: Json | null
          id: string
          proposed_module: string
          reviewed_at: string | null
          reviewed_by: string | null
          skill_id: string
          status: string
        }
        Insert: {
          changes_summary?: string | null
          confidence?: number | null
          created_at?: string
          current_module: string
          evidence?: Json | null
          id?: string
          proposed_module: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill_id: string
          status?: string
        }
        Update: {
          changes_summary?: string | null
          confidence?: number | null
          created_at?: string
          current_module?: string
          evidence?: Json | null
          id?: string
          proposed_module?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_revisions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skill_performance"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skill_revisions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          bad_examples: Json
          confidence: string
          created_at: string
          description: string
          good_examples: Json
          gotchas: string[]
          id: string
          injected_into: Database["public"]["Enums"]["skill_agent"]
          is_active: boolean
          is_system: boolean
          last_reviewed_at: string | null
          name: string
          org_id: string | null
          parent_id: string | null
          performance_notes: string
          project_id: string | null
          prompt_module: string
          sort_order: number
          source_refs: Json
          tags: string[]
          trigger_description: string
          trigger_when: Json
          type: Database["public"]["Enums"]["skill_type"]
          updated_at: string
        }
        Insert: {
          bad_examples?: Json
          confidence?: string
          created_at?: string
          description: string
          good_examples?: Json
          gotchas?: string[]
          id?: string
          injected_into?: Database["public"]["Enums"]["skill_agent"]
          is_active?: boolean
          is_system?: boolean
          last_reviewed_at?: string | null
          name: string
          org_id?: string | null
          parent_id?: string | null
          performance_notes?: string
          project_id?: string | null
          prompt_module: string
          sort_order?: number
          source_refs?: Json
          tags?: string[]
          trigger_description?: string
          trigger_when?: Json
          type: Database["public"]["Enums"]["skill_type"]
          updated_at?: string
        }
        Update: {
          bad_examples?: Json
          confidence?: string
          created_at?: string
          description?: string
          good_examples?: Json
          gotchas?: string[]
          id?: string
          injected_into?: Database["public"]["Enums"]["skill_agent"]
          is_active?: boolean
          is_system?: boolean
          last_reviewed_at?: string | null
          name?: string
          org_id?: string | null
          parent_id?: string | null
          performance_notes?: string
          project_id?: string | null
          prompt_module?: string
          sort_order?: number
          source_refs?: Json
          tags?: string[]
          trigger_description?: string
          trigger_when?: Json
          type?: Database["public"]["Enums"]["skill_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "skill_performance"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "skills_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_seen: string | null
          org_id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          last_seen?: string | null
          org_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_seen?: string | null
          org_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vera_evaluation_scenarios: {
        Row: {
          category: string
          created_at: string
          description: string
          expected_behaviors: string[]
          failure_modes: string[]
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          org_id: string | null
          project_id: string | null
          prompt: string
          rubric: Json
          sort_order: number
          source_refs: Json
          tags: string[]
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          expected_behaviors?: string[]
          failure_modes?: string[]
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          org_id?: string | null
          project_id?: string | null
          prompt: string
          rubric?: Json
          sort_order?: number
          source_refs?: Json
          tags?: string[]
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          expected_behaviors?: string[]
          failure_modes?: string[]
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          org_id?: string | null
          project_id?: string | null
          prompt?: string
          rubric?: Json
          sort_order?: number
          source_refs?: Json
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vera_evaluation_scenarios_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vera_evaluation_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vera_memories: {
        Row: {
          created_at: string
          id: string
          is_pinned: boolean
          key: string
          kind: string
          org_id: string
          source: string
          updated_at: string
          user_id: string | null
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_pinned?: boolean
          key: string
          kind?: string
          org_id: string
          source?: string
          updated_at?: string
          user_id?: string | null
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          is_pinned?: boolean
          key?: string
          kind?: string
          org_id?: string
          source?: string
          updated_at?: string
          user_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "vera_memories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      video_jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          key_source: string
          message_id: string | null
          operator_user_id: string | null
          post_id: string | null
          project_id: string | null
          prompt: string | null
          request_id: string
          session_id: string | null
          slug: string
          status: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          key_source?: string
          message_id?: string | null
          operator_user_id?: string | null
          post_id?: string | null
          project_id?: string | null
          prompt?: string | null
          request_id: string
          session_id?: string | null
          slug: string
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          key_source?: string
          message_id?: string | null
          operator_user_id?: string | null
          post_id?: string | null
          project_id?: string | null
          prompt?: string | null
          request_id?: string
          session_id?: string | null
          slug?: string
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_jobs_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_jobs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      post_final_outcome: {
        Row: {
          edit_summary: Json | null
          feedback: string | null
          outcome: string | null
          post_id: string | null
          recorded_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_outcomes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_performance: {
        Row: {
          approval_rate: number | null
          approved_count: number | null
          edited_count: number | null
          last_used_at: string | null
          name: string | null
          org_id: string | null
          project_id: string | null
          rejected_count: number | null
          skill_id: string | null
          total_invocations: number | null
          type: Database["public"]["Enums"]["skill_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "skills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_publish_lock: {
        Args: { p_locked_by: string; p_post_id: string; p_publisher_id: string }
        Returns: boolean
      }
      get_publisher_credentials: { Args: { p_id: string }; Returns: Json }
      is_platform_admin: { Args: { p_user: string }; Returns: boolean }
      kai_org_id: { Args: never; Returns: string }
      kb_semantic_search: {
        Args: {
          match_count?: number
          org_filter: string
          query_embedding: string
          threshold?: number
        }
        Returns: {
          excerpt: string
          id: string
          similarity: number
          source: string
          title: string
        }[]
      }
      list_chat_sessions: {
        Args: { p_project_id: string }
        Returns: {
          last_at: string
          message_count: number
          session_id: string
          title: string
        }[]
      }
      refresh_all_competitor_intel: {
        Args: never
        Returns: {
          org_id: string
          request_id: number
        }[]
      }
      refresh_all_linkedin_audits: {
        Args: never
        Returns: {
          brew_request_id: number
          org_id: string
          profile_request_id: number
        }[]
      }
      release_publish_lock: {
        Args: { p_post_id: string; p_publisher_id: string }
        Returns: undefined
      }
      set_publisher_credentials: {
        Args: { p_creds: Json; p_id: string }
        Returns: string
      }
    }
    Enums: {
      channel_type:
        | "linkedin_personal"
        | "linkedin_company"
        | "linkedin_newsletter"
        | "blog"
        | "medium"
        | "youtube"
        | "twitter"
      skill_agent: "strategist" | "writer" | "brand_guard" | "publisher" | "all"
      skill_type:
        | "platform"
        | "content"
        | "brand"
        | "persona"
        | "enrichment"
        | "tool"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      channel_type: [
        "linkedin_personal",
        "linkedin_company",
        "linkedin_newsletter",
        "blog",
        "medium",
        "youtube",
        "twitter",
      ],
      skill_agent: ["strategist", "writer", "brand_guard", "publisher", "all"],
      skill_type: [
        "platform",
        "content",
        "brand",
        "persona",
        "enrichment",
        "tool",
      ],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
