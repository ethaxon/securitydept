use std::path::PathBuf;
use std::future::Future;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use securitydept_core::models::DataFile;
use securitydept_core::store::Store;

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
    let store = Store::load(&path).await.expect("load store");

    let created = store
        .create_entry(securitydept_core::models::AuthEntry::new_token(
            "entry-a".to_string(),
            "hash-a".to_string(),
            vec![],
        ))
        .await
        .expect("create entry");

    let mut disk_data: DataFile =
        serde_json::from_str(&tokio::fs::read_to_string(&path).await.expect("read data file"))
            .expect("parse data file");
    disk_data.entries[0].name = "entry-from-external-change".to_string();
    tokio::fs::write(
        &path,
        serde_json::to_string_pretty(&disk_data).expect("serialize data file"),
    )
    .await
    .expect("write changed data file");

    let synced = wait_until(Duration::from_secs(4), Duration::from_millis(100), || async {
        match store.get_entry(&created.id).await {
            Ok(entry) => entry.name == "entry-from-external-change",
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
    let store_a = Store::load(&path).await.expect("load store a");
    let store_b = Store::load(&path).await.expect("load store b");

    let create_a = store_a.create_entry(securitydept_core::models::AuthEntry::new_token(
        "entry-a".to_string(),
        "hash-a".to_string(),
        vec![],
    ));
    let create_b = store_b.create_entry(securitydept_core::models::AuthEntry::new_token(
        "entry-b".to_string(),
        "hash-b".to_string(),
        vec![],
    ));

    let (result_a, result_b) = tokio::join!(create_a, create_b);
    result_a.expect("create entry a");
    result_b.expect("create entry b");

    let both_present = wait_until(Duration::from_secs(4), Duration::from_millis(100), || async {
        let content = match tokio::fs::read_to_string(&path).await {
            Ok(v) => v,
            Err(_) => return false,
        };
        let data: DataFile = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return false,
        };
        let has_a = data.entries.iter().any(|e| e.name == "entry-a");
        let has_b = data.entries.iter().any(|e| e.name == "entry-b");
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
    let store = Store::load(&path).await.expect("load store");

    let e1 = store
        .create_entry(securitydept_core::models::AuthEntry::new_token(
            "entry-a".to_string(),
            "hash-a".to_string(),
            vec![],
        ))
        .await
        .expect("create entry a");

    let e2 = store
        .create_entry(securitydept_core::models::AuthEntry::new_token(
            "entry-b".to_string(),
            "hash-b".to_string(),
            vec![],
        ))
        .await
        .expect("create entry b");

    let created_group = store
        .create_group(
            securitydept_core::models::Group::new("g-delete".to_string()),
            Some(vec![e1.id.clone(), e2.id.clone()]),
        )
        .await
        .expect("create group");

    store
        .delete_group(&created_group.id)
        .await
        .expect("delete group");

    let reloaded_e1 = store.get_entry(&e1.id).await.expect("reload entry a");
    let reloaded_e2 = store.get_entry(&e2.id).await.expect("reload entry b");
    assert!(!reloaded_e1.group_ids.iter().any(|g| g == &created_group.id));
    assert!(!reloaded_e2.group_ids.iter().any(|g| g == &created_group.id));

    let _ = tokio::fs::remove_file(&path).await;
}

#[tokio::test]
async fn update_group_updates_entry_memberships_and_renames_group() {
    let path = temp_data_file_path("store-update-group-relations");
    let store = Store::load(&path).await.expect("load store");

    let e1 = store
        .create_entry(securitydept_core::models::AuthEntry::new_token(
            "entry-a".to_string(),
            "hash-a".to_string(),
            vec![],
        ))
        .await
        .expect("create entry a");

    let e2 = store
        .create_entry(securitydept_core::models::AuthEntry::new_token(
            "entry-b".to_string(),
            "hash-b".to_string(),
            vec![],
        ))
        .await
        .expect("create entry b");

    let created_group = store
        .create_group(
            securitydept_core::models::Group::new("old-group".to_string()),
            Some(vec![e1.id.clone()]),
        )
        .await
        .expect("create group");

    store
        .update_group(
            &created_group.id,
            "new-group".to_string(),
            Some(vec![e2.id.clone()]),
        )
        .await
        .expect("update group");

    let reloaded_e1 = store.get_entry(&e1.id).await.expect("reload entry a");
    let reloaded_e2 = store.get_entry(&e2.id).await.expect("reload entry b");
    assert!(!reloaded_e1.group_ids.iter().any(|g| g == &created_group.id));
    assert!(reloaded_e2.group_ids.iter().any(|g| g == &created_group.id));

    let _ = tokio::fs::remove_file(&path).await;
}
