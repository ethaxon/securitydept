use std::{
	future::Future,
	path::PathBuf,
	time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use securitydept_creds_manage::{models::DataFile, store::CredsManageStore};

fn temp_data_file_path(name: &str) -> PathBuf {
	let millis = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.expect("system time before unix epoch")
		.as_millis();

	std::env::temp_dir().join(format!("securitydept-{name}-{millis}.json"))
}

async fn wait_until<F, Fut>(timeout: Duration, interval: Duration, mut condition: F) -> bool
where
	F: FnMut() -> Fut,
	Fut: Future<Output = bool>,
{
	let deadline = Instant::now() + timeout;
	loop {
		if condition().await {
			return true;
		}

		if Instant::now() >= deadline {
			return false;
		}

		tokio::time::sleep(interval).await;
	}
}

#[tokio::test]
async fn store_syncs_external_file_changes() {
	let path = temp_data_file_path("store-sync");
	let store = CredsManageStore::load(&path).await.expect("load store");

	let (created, _) = store
		.create_token_entry("entry-a".to_string(), vec![])
		.await
		.expect("create entry");

	let mut disk_data: DataFile = serde_json::from_str(
		&tokio::fs::read_to_string(&path)
			.await
			.expect("read data file"),
	)
	.expect("parse data file");
	disk_data.token_creds[0].meta.name = "entry-from-external-change".to_string();
	tokio::fs::write(
		&path,
		serde_json::to_string_pretty(&disk_data).expect("serialize data file"),
	)
	.await
	.expect("write changed data file");

	let synced =
		wait_until(Duration::from_secs(4), Duration::from_millis(100), || async {
			match store.get_entry(&created.meta.id).await {
				Ok(entry) => entry.meta.name == "entry-from-external-change",
				Err(_) => false,
			}
		})
		.await;

	assert!(
		synced,
		"store cache did not sync external file change within timeout"
	);

	let _ = tokio::fs::remove_file(&path).await;
}

#[tokio::test]
async fn concurrent_store_instances_do_not_lose_updates() {
	let path = temp_data_file_path("store-concurrent");
	let store_a = CredsManageStore::load(&path).await.expect("load store a");
	let store_b = CredsManageStore::load(&path).await.expect("load store b");

	let create_a = store_a.create_token_entry("entry-a".to_string(), vec![]);
	let create_b = store_b.create_token_entry("entry-b".to_string(), vec![]);

	let (result_a, result_b) = tokio::join!(create_a, create_b);
	result_a.expect("create entry a");
	result_b.expect("create entry b");

	let both_present =
		wait_until(Duration::from_secs(4), Duration::from_millis(100), || async {
			let content = match tokio::fs::read_to_string(&path).await {
				Ok(v) => v,
				Err(_) => return false,
			};
			let data: DataFile = match serde_json::from_str(&content) {
				Ok(v) => v,
				Err(_) => return false,
			};
			let has_a = data.token_creds.iter().any(|e| e.meta.name == "entry-a");
			let has_b = data.token_creds.iter().any(|e| e.meta.name == "entry-b");
			has_a && has_b
		})
		.await;

	assert!(
		both_present,
		"final data file should contain both concurrently created entries"
	);

	let _ = tokio::fs::remove_file(&path).await;
}

#[tokio::test]
async fn delete_group_removes_group_membership_from_entries() {
	let path = temp_data_file_path("store-delete-group-relations");
	let store = CredsManageStore::load(&path).await.expect("load store");

	let (e1, _) = store
		.create_token_entry("entry-a".to_string(), vec![])
		.await
		.expect("create entry a");

	let (e2, _) = store
		.create_token_entry("entry-b".to_string(), vec![])
		.await
		.expect("create entry b");

	let created_group = store
		.create_group(
			securitydept_creds_manage::models::Group::new("g-delete".to_string()),
			Some(vec![e1.meta.id.clone(), e2.meta.id.clone()]),
		)
		.await
		.expect("create group");

	store
		.delete_group(&created_group.id)
		.await
		.expect("delete group");

	let reloaded_e1 = store.get_entry(&e1.meta.id).await.expect("reload entry a");
	let reloaded_e2 = store.get_entry(&e2.meta.id).await.expect("reload entry b");
	assert!(
		!reloaded_e1
			.meta
			.group_ids
			.iter()
			.any(|g| g == &created_group.id)
	);
	assert!(
		!reloaded_e2
			.meta
			.group_ids
			.iter()
			.any(|g| g == &created_group.id)
	);

	let _ = tokio::fs::remove_file(&path).await;
}

#[tokio::test]
async fn update_group_updates_entry_memberships_and_renames_group() {
	let path = temp_data_file_path("store-update-group-relations");
	let store = CredsManageStore::load(&path).await.expect("load store");

	let (e1, _) = store
		.create_token_entry("entry-a".to_string(), vec![])
		.await
		.expect("create entry a");

	let (e2, _) = store
		.create_token_entry("entry-b".to_string(), vec![])
		.await
		.expect("create entry b");

	let created_group = store
		.create_group(
			securitydept_creds_manage::models::Group::new("old-group".to_string()),
			Some(vec![e1.meta.id.clone()]),
		)
		.await
		.expect("create group");

	store
		.update_group(
			&created_group.id,
			"new-group".to_string(),
			Some(vec![e2.meta.id.clone()]),
		)
		.await
		.expect("update group");

	let reloaded_e1 = store.get_entry(&e1.meta.id).await.expect("reload entry a");
	let reloaded_e2 = store.get_entry(&e2.meta.id).await.expect("reload entry b");
	assert!(
		!reloaded_e1
			.meta
			.group_ids
			.iter()
			.any(|g| g == &created_group.id)
	);
	assert!(
		reloaded_e2
			.meta
			.group_ids
			.iter()
			.any(|g| g == &created_group.id)
	);

	let _ = tokio::fs::remove_file(&path).await;
}