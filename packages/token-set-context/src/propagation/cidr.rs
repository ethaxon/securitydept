use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    str::FromStr,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedCidr {
    V4 { network: u32, prefix: u8 },
    V6 { network: u128, prefix: u8 },
}

impl ParsedCidr {
    pub fn parse(value: &str) -> Option<Self> {
        let (ip, prefix) = value.split_once('/')?;
        let ip = IpAddr::from_str(ip).ok()?;
        let prefix = prefix.parse::<u8>().ok()?;

        match ip {
            IpAddr::V4(ip) if prefix <= 32 => {
                let raw = u32::from(ip);
                let mask = if prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                Some(Self::V4 {
                    network: raw & mask,
                    prefix,
                })
            }
            IpAddr::V6(ip) if prefix <= 128 => {
                let raw = u128::from(ip);
                let mask = if prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                Some(Self::V6 {
                    network: raw & mask,
                    prefix,
                })
            }
            _ => None,
        }
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        match (self, ip) {
            (Self::V4 { network, prefix }, IpAddr::V4(ip)) => {
                let mask = if *prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                (u32::from(ip) & mask) == *network
            }
            (Self::V6 { network, prefix }, IpAddr::V6(ip)) => {
                let mask = if *prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                (u128::from(ip) & mask) == *network
            }
            _ => false,
        }
    }
}

pub fn is_sensitive_ip_literal(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_sensitive_ipv4(ip),
        IpAddr::V6(ip) => is_sensitive_ipv6(ip),
    }
}

fn is_sensitive_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
}

fn is_sensitive_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local() || ip.is_unicast_link_local()
}
