<script lang="ts">
  import "../app.css";

  let { children, data } = $props<{
    data: {
      session: import("@auth/sveltekit").Session | null;
      googleOAuthEnabled: boolean;
    };
  }>();
</script>

{@render children()}
