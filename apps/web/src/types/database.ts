// Aligné sur supabase/migrations/0001_initial_schema.sql
// Régénérable : npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          display_name: string | null
          avatar_url: string | null
          role: Database['public']['Enums']['user_role']
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: {
          username?: string | null
          display_name?: string | null
          avatar_url?: string | null
        }
        Relationships: []
      }
      genres: {
        Row: { id: number; slug: string; name: string; is_family: boolean }
        Insert: { slug: string; name: string }
        Update: { slug?: string; name?: string }
        Relationships: []
      }
      titles: {
        Row: {
          id: string
          type: Database['public']['Enums']['title_type']
          slug: string
          title: string
          original_title: string | null
          synopsis: string | null
          release_year: number | null
          runtime_minutes: number | null
          maturity_rating: string | null
          poster_url: string | null
          backdrop_url: string | null
          logo_url: string | null
          trailer_url: string | null
          tmdb_id: number | null
          imdb_id: string | null
          metadata: Json
          is_published: boolean
          published_at: string | null
          created_at: string
          updated_at: string
          search: unknown
        }
        Insert: {
          id?: string
          type: Database['public']['Enums']['title_type']
          slug: string
          title: string
          original_title?: string | null
          synopsis?: string | null
          release_year?: number | null
          runtime_minutes?: number | null
          maturity_rating?: string | null
          poster_url?: string | null
          backdrop_url?: string | null
          logo_url?: string | null
          trailer_url?: string | null
          tmdb_id?: number | null
          imdb_id?: string | null
          metadata?: Json
          is_published?: boolean
          published_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['titles']['Insert']>
        Relationships: []
      }
      title_genres: {
        Row: { title_id: string; genre_id: number }
        Insert: { title_id: string; genre_id: number }
        Update: { title_id?: string; genre_id?: number }
        Relationships: [
          { foreignKeyName: 'title_genres_title_id_fkey'; columns: ['title_id']; isOneToOne: false; referencedRelation: 'titles'; referencedColumns: ['id'] },
          { foreignKeyName: 'title_genres_genre_id_fkey'; columns: ['genre_id']; isOneToOne: false; referencedRelation: 'genres'; referencedColumns: ['id'] },
        ]
      }
      seasons: {
        Row: {
          id: string
          title_id: string
          season_number: number
          name: string | null
          overview: string | null
          poster_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title_id: string
          season_number: number
          name?: string | null
          overview?: string | null
          poster_url?: string | null
        }
        Update: Partial<Database['public']['Tables']['seasons']['Insert']>
        Relationships: [
          { foreignKeyName: 'seasons_title_id_fkey'; columns: ['title_id']; isOneToOne: false; referencedRelation: 'titles'; referencedColumns: ['id'] },
        ]
      }
      episodes: {
        Row: {
          id: string
          title_id: string
          season_id: string
          episode_number: number
          name: string | null
          overview: string | null
          runtime_minutes: number | null
          still_url: string | null
          air_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title_id: string
          season_id: string
          episode_number: number
          name?: string | null
          overview?: string | null
          runtime_minutes?: number | null
          still_url?: string | null
          air_date?: string | null
        }
        Update: Partial<Database['public']['Tables']['episodes']['Insert']>
        Relationships: [
          { foreignKeyName: 'episodes_season_id_title_id_fkey'; columns: ['season_id', 'title_id']; isOneToOne: false; referencedRelation: 'seasons'; referencedColumns: ['id', 'title_id'] },
        ]
      }
      media_sources: {
        Row: {
          id: string
          title_id: string | null
          episode_id: string | null
          provider: Database['public']['Enums']['video_provider']
          external_id: string | null
          raw_url: string | null
          quality: Database['public']['Enums']['video_quality']
          container: string | null
          video_codec: string | null
          audio_languages: string[]
          subtitle_languages: string[]
          size_bytes: number | null
          checksum: string | null
          priority: number
          is_active: boolean
          last_checked_at: string | null
          last_status: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title_id?: string | null
          episode_id?: string | null
          provider: Database['public']['Enums']['video_provider']
          external_id?: string | null
          raw_url?: string | null
          quality?: Database['public']['Enums']['video_quality']
          container?: string | null
          video_codec?: string | null
          audio_languages?: string[]
          subtitle_languages?: string[]
          size_bytes?: number | null
          checksum?: string | null
          priority?: number
          is_active?: boolean
          last_checked_at?: string | null
          last_status?: number | null
        }
        Update: Partial<Database['public']['Tables']['media_sources']['Insert']>
        Relationships: [
          { foreignKeyName: 'media_sources_title_id_fkey'; columns: ['title_id']; isOneToOne: false; referencedRelation: 'titles'; referencedColumns: ['id'] },
          { foreignKeyName: 'media_sources_episode_id_fkey'; columns: ['episode_id']; isOneToOne: false; referencedRelation: 'episodes'; referencedColumns: ['id'] },
        ]
      }
      subscriptions: {
        Row: {
          user_id: string
          status: Database['public']['Enums']['subscription_status']
          plan: string
          started_at: string
          ends_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      subscription_events: {
        Row: {
          id: number
          user_id: string
          source: 'code' | 'admin_adjust' | 'admin_set' | 'admin_status'
          delta_days: number | null
          previous_ends_at: string | null
          new_ends_at: string | null
          status: Database['public']['Enums']['subscription_status'] | null
          code_id: string | null
          actor_id: string | null
          note: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      activation_codes: {
        Row: {
          id: string
          code_hash: string
          code_hint: string
          duration_days: number
          status: Database['public']['Enums']['activation_code_status']
          label: string | null
          expires_at: string | null
          created_by: string | null
          created_at: string
          used_by: string | null
          used_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      ip_bans: {
        Row: { id: string; ip: string; reason: string | null; expires_at: string | null; created_by: string | null; created_at: string }
        Insert: { ip: string; reason?: string | null; expires_at?: string | null; created_by?: string | null }
        Update: { ip?: string; reason?: string | null; expires_at?: string | null }
        Relationships: []
      }
      subtitles: {
        Row: {
          id: string
          title_id: string | null
          episode_id: string | null
          language: string
          label: string
          url: string
          format: 'vtt' | 'srt'
          storage_path: string | null
          is_default: boolean
          is_forced: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          title_id?: string | null
          episode_id?: string | null
          language: string
          label: string
          url: string
          format: 'vtt' | 'srt'
          storage_path?: string | null
          is_default?: boolean
          is_forced?: boolean
          created_by?: string | null
        }
        Update: { language?: string; label?: string; is_default?: boolean; is_forced?: boolean }
        Relationships: []
      }
      viewer_profiles: {
        Row: {
          id: string
          user_id: string
          name: string
          avatar_url: string | null
          is_kids_profile: boolean
          position: number
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string | null
          type: Database['public']['Enums']['notification_type']
          message: string
          link: string | null
          read_status: boolean
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: { read_status?: boolean }
        Relationships: []
      }
      user_favorites: {
        Row: { user_id: string; profile_id: string; title_id: string; created_at: string }
        Insert: { title_id: string; profile_id: string }
        Update: never
        Relationships: [
          { foreignKeyName: 'user_favorites_title_id_fkey'; columns: ['title_id']; isOneToOne: false; referencedRelation: 'titles'; referencedColumns: ['id'] },
        ]
      }
      watch_progress: {
        Row: {
          id: string
          user_id: string
          profile_id: string
          title_id: string
          episode_id: string | null
          position_seconds: number
          duration_seconds: number | null
          completed: boolean
          updated_at: string
        }
        Insert: {
          profile_id: string
          title_id: string
          episode_id?: string | null
          position_seconds?: number
          duration_seconds?: number | null
        }
        Update: {
          position_seconds?: number
          duration_seconds?: number | null
        }
        Relationships: [
          { foreignKeyName: 'watch_progress_title_id_fkey'; columns: ['title_id']; isOneToOne: false; referencedRelation: 'titles'; referencedColumns: ['id'] },
          { foreignKeyName: 'watch_progress_episode_id_title_id_fkey'; columns: ['episode_id', 'title_id']; isOneToOne: false; referencedRelation: 'episodes'; referencedColumns: ['id', 'title_id'] },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      has_active_subscription: { Args: { p_user?: string | null }; Returns: boolean }
      redeem_activation_code: { Args: { p_code: string }; Returns: Json }
      admin_adjust_subscription: { Args: { p_user: string; p_days: number; p_note?: string | null }; Returns: string }
      admin_set_subscription: {
        Args: {
          p_user: string
          p_ends_at: string | null
          p_status?: Database['public']['Enums']['subscription_status']
          p_note?: string | null
        }
        Returns: undefined
      }
      admin_generate_codes: {
        Args: { p_count: number; p_duration_days: number; p_label?: string | null; p_expires_at?: string | null }
        Returns: { id: string; code: string }[]
      }
      admin_set_code_status: {
        Args: { p_id: string; p_status: Database['public']['Enums']['activation_code_status'] }
        Returns: undefined
      }
      admin_list_users: {
        Args: { p_q?: string | null; p_filter?: string | null; p_limit?: number; p_offset?: number }
        Returns: {
          id: string
          email: string
          display_name: string | null
          username: string | null
          role: Database['public']['Enums']['user_role']
          created_at: string
          last_sign_in_at: string | null
          sub_status: Database['public']['Enums']['subscription_status'] | null
          sub_ends_at: string | null
          total_count: number
        }[]
      }
      admin_set_api_key: { Args: { p_name: string; p_value: string }; Returns: undefined }
      admin_delete_api_key: { Args: { p_name: string }; Returns: undefined }
      admin_list_api_keys: {
        Args: Record<PropertyKey, never>
        Returns: { name: string; last4: string | null; updated_at: string; updated_by_email: string | null }[]
      }
      admin_stats_overview: { Args: { p_days?: number }; Returns: Json }
      admin_stats_top_titles: {
        Args: { p_days?: number | null; p_limit?: number }
        Returns: {
          title_id: string
          title: string
          slug: string
          type: Database['public']['Enums']['title_type']
          poster_url: string | null
          viewers: number
          watch_seconds: number
          completions: number
        }[]
      }
      admin_stats_user_watch_time: {
        Args: { p_days?: number | null; p_limit?: number; p_user?: string | null }
        Returns: {
          user_id: string
          email: string
          display_name: string | null
          watch_seconds: number
          titles_watched: number
          last_day: string
        }[]
      }
      my_notifications: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          type: Database['public']['Enums']['notification_type']
          message: string
          link: string | null
          is_global: boolean
          read: boolean
          created_at: string
        }[]
      }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      mark_all_notifications_read: { Args: Record<PropertyKey, never>; Returns: undefined }
      admin_send_notification: {
        Args: {
          p_message: string
          p_type?: Database['public']['Enums']['notification_type']
          p_link?: string | null
          p_user?: string | null
        }
        Returns: string
      }
      my_watch_history: {
        Args: { p_profile_id: string; p_limit?: number; p_offset?: number }
        Returns: Database['public']['CompositeTypes']['history_row'][]
      }
      my_continue_watching: {
        Args: { p_profile_id: string; p_limit?: number }
        Returns: Database['public']['CompositeTypes']['history_row'][]
      }
      my_viewer_profiles: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; name: string; avatar_url: string | null; is_kids_profile: boolean; has_pin: boolean; sort_order: number }[]
      }
      unlock_viewer_profile: { Args: { p_id: string; p_pin?: string | null }; Returns: Json }
      create_viewer_profile: {
        Args: { p_name: string; p_avatar_url?: string | null; p_is_kids?: boolean; p_new_pin?: string | null; p_parental_pin?: string | null }
        Returns: Json
      }
      update_viewer_profile: {
        Args: {
          p_id: string
          p_name: string
          p_avatar_url?: string | null
          p_is_kids?: boolean | null
          p_new_pin?: string | null
          p_pin?: string | null
        }
        Returns: Json
      }
      delete_viewer_profile: { Args: { p_id: string; p_pin?: string | null }; Returns: Json }
      can_profile_watch: { Args: { p_profile_id: string; p_title_id: string }; Returns: string }
      catalog_titles: {
        Args: { p_kids?: boolean; p_limit?: number }
        Returns: {
          id: string
          type: Database['public']['Enums']['title_type']
          slug: string
          title: string
          synopsis: string | null
          release_year: number | null
          runtime_minutes: number | null
          maturity_rating: string | null
          poster_url: string | null
          backdrop_url: string | null
          logo_url: string | null
          published_at: string | null
          genres: Json
        }[]
      }
      search_titles: {
        Args: {
          p_q?: string | null
          p_type?: Database['public']['Enums']['title_type'] | null
          p_genre?: string | null
          p_limit?: number
          p_offset?: number
          p_kids?: boolean
        }
        Returns: {
          id: string
          type: Database['public']['Enums']['title_type']
          slug: string
          title: string
          synopsis: string | null
          release_year: number | null
          runtime_minutes: number | null
          maturity_rating: string | null
          poster_url: string | null
          backdrop_url: string | null
          logo_url: string | null
          published_at: string | null
          genres: Json
          rank: number
          total_count: number
        }[]
      }
      admin_save_title: {
        Args: { p_title: Json; p_genre_ids?: number[]; p_sources?: Json | null }
        Returns: string
      }
      save_progress: {
        Args: {
          p_profile_id: string
          p_title_id: string
          p_episode_id: string | null
          p_position_seconds: number
          p_duration_seconds?: number | null
        }
        Returns: undefined
      }
      get_available_qualities: {
        Args: { p_title_id?: string | null; p_episode_id?: string | null }
        Returns: {
          quality: Database['public']['Enums']['video_quality']
          audio_languages: string[]
          subtitle_languages: string[]
        }[]
      }
    }
    Enums: {
      user_role: 'user' | 'admin'
      title_type: 'movie' | 'series'
      video_provider: 'pixeldrain' | 'onefichier' | 'alist' | 'other'
      video_quality: '480p' | '720p' | '1080p' | '2160p'
      subscription_status: 'active' | 'suspended' | 'canceled'
      activation_code_status: 'active' | 'used' | 'revoked'
      notification_type: 'info' | 'new_content' | 'subscription' | 'warning' | 'system'
    }
    CompositeTypes: {
      /** forme de retour de my_watch_history / my_continue_watching */
      history_row: {
        title_id: string
        type: Database['public']['Enums']['title_type']
        slug: string
        title: string
        synopsis: string | null
        release_year: number | null
        runtime_minutes: number | null
        maturity_rating: string | null
        poster_url: string | null
        backdrop_url: string | null
        logo_url: string | null
        published_at: string | null
        episode_id: string | null
        season_number: number | null
        episode_number: number | null
        episode_name: string | null
        position_seconds: number
        duration_seconds: number | null
        ratio: number
        updated_at: string
        total_count: number
      }
    }
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]
