<script lang="ts">
  import "../app.css";

  let { children, data } = $props<{
    data: { session: import("@auth/sveltekit").Session | null };
  }>();
</script>

{@render children()}
